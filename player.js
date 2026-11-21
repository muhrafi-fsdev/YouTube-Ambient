(() => {
  "use strict";

  const watchSelector = "ytd-watch-flexy, ytd-watch-grid";
  const videoSelector = "video.html5-main-video";
  const nativeSelector = "#cinematics, ytd-cinematic-container-renderer, yt-cinematic-container";
  const relevantSelector = `${watchSelector}, #movie_player, video`;
  const sampleInterval = 64;
  const storage = chrome.storage.local;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  let settings = AmbientGlassSettings.defaults;
  let settingsLoaded = false;
  let session = null;
  let leavingDocument = false;

  function allowsMotion() {
    return settings.motion && !reducedMotion?.matches;
  }

  function isWatchPage() {
    return location.pathname === "/watch";
  }

  function watchVideoId() {
    return new URLSearchParams(location.search).get("v") ?? "";
  }

  function nativeAmbientVisible(watch) {
    if (!watch) return false;

    return [...watch.querySelectorAll(nativeSelector)].some((renderer) => {
      const surface = renderer.querySelector("canvas, .ytp-cinematic-container");
      if (!surface || !surface.getClientRects().length) return false;

      for (let node = surface; node && node !== watch; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0) {
          return false;
        }
      }
      return true;
    });
  }

  class WatchSession {
    constructor(id) {
      this.id = id;
      this.events = new AbortController();
      this.frame = 0;
      this.timer = 0;
      this.videoFrame = null;
      this.canvasPaintTime = -Infinity;
      this.colorSampleTime = -Infinity;
      this.nextDetailTime = -Infinity;
      this.watch = null;
      this.player = null;
      this.video = null;
      this.playback = null;
      this.canvas = null;
      this.renderer = null;
      this.sides = null;
      this.hasFrame = false;
      this.unavailable = false;
      this.buffering = false;
      this.lastVideoTime = null;
      this.resize = new ResizeObserver(() => this.schedule());
      this.playerChanges = new MutationObserver(() => this.schedule());
      this.layoutChanges = new MutationObserver((records) => {
        const changed = records.some((record) => {
          if (record.type === "attributes") return record.target.matches(watchSelector);

          return [...record.addedNodes, ...record.removedNodes].some((node) =>
            node.nodeType === Node.ELEMENT_NODE
              && (node.matches(relevantSelector) || node.querySelector(relevantSelector)));
        });
        if (!this.video || !this.video.isConnected || changed) this.schedule();
      });
      this.layoutChanges.observe(document.querySelector("ytd-app") ?? document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["hidden", "theater", "fullscreen", "mini-player", "miniplayer"],
      });

      const { signal } = this.events;
      window.addEventListener("resize", () => this.schedule(), { signal, passive: true });
      document.addEventListener("visibilitychange", () => this.refreshPlayback(), { signal });
      document.addEventListener("fullscreenchange", () => this.sync(), { signal });
      this.sync();
    }

    schedule() {
      if (!this.frame) {
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.sync();
        });
      }
    }

    sync() {
      if (!isWatchPage() || !settings.enabled) return;

      const watch = [...document.querySelectorAll(watchSelector)].find((node) => !node.hidden) ?? null;
      const player = watch?.querySelector("#movie_player") ?? null;
      const video = player?.querySelector(videoSelector) ?? player?.querySelector("video") ?? null;

      if (watch !== this.watch || player !== this.player || video !== this.video) {
        this.releasePlayer();
        this.watch = watch;
        this.player = player;
        this.video = video;
        if (watch) this.resize.observe(watch);
        if (player) {
          this.resize.observe(player);
          this.playerChanges.observe(player, { attributes: true, attributeFilter: ["class"] });
        }
        if (video) this.bindVideo();
      }

      this.updateSurface();
      this.refreshPlayback();
    }

    bindVideo() {
      this.playback = new AbortController();
      const { signal } = this.playback;

      this.canvas = document.createElement("canvas");
      this.canvas.setAttribute("data-yag-ambient", "");
      this.canvas.setAttribute("aria-hidden", "true");
      this.renderer = AmbientGlassFrame.create(this.canvas);
      this.unavailable = !this.renderer || Boolean(this.video.mediaKeys);
      this.watch.prepend(this.canvas);
      this.sides = AmbientGlassSides.create(this.watch, this.player, this.video);
      this.resize.observe(this.video);

      this.video.addEventListener("loadedmetadata", () => this.schedule(), { signal });
      this.video.addEventListener("resize", () => {
        this.resetVideo();
        this.schedule();
      }, { signal });

      for (const name of ["play", "playing", "canplay", "loadeddata", "seeked"]) {
        this.video.addEventListener(name, () => {
          this.buffering = false;
          this.refreshPlayback();
        }, { signal });
      }
      for (const name of ["pause", "ended", "waiting", "seeking"]) {
        this.video.addEventListener(name, () => {
          this.buffering = name === "waiting" || name === "seeking";
          this.stopSampling();
        }, { signal });
      }
      for (const name of ["emptied", "loadstart"]) {
        this.video.addEventListener(name, () => this.resetVideo(), { signal });
      }
      this.video.addEventListener("encrypted", () => this.useFallback(), { signal });
    }

    resetVideo() {
      this.stopSampling();
      // Quality switches and seeking should not replace the frozen image.
      if (this.hasFrame && !allowsMotion()) return;
      this.renderer?.reset();
      this.hasFrame = false;
      this.unavailable = !this.renderer || Boolean(this.video.mediaKeys);
      this.buffering = false;
      this.lastVideoTime = null;
      this.canvasPaintTime = -Infinity;
      this.colorSampleTime = -Infinity;
      this.sides?.clear();
      this.updateAmbientVisibility();
    }

    useFallback() {
      this.stopSampling();
      this.unavailable = true;
      this.hasFrame = false;
      this.sides?.clear();
      this.updateAmbientVisibility();
    }

    surfaceVisible() {
      return Boolean(this.watch?.hasAttribute("data-yag-surface"));
    }

    updateSurface() {
      if (!this.watch) return;

      const rect = this.player?.getBoundingClientRect();
      const view = this.watch.getBoundingClientRect();
      const fullscreen = document.fullscreenElement;
      const cinema = Boolean(fullscreen || this.watch.hasAttribute("fullscreen"));
      const wasCinema = this.watch.hasAttribute("data-yag-fullscreen");
      const active = rect?.width > 0 && rect.height > 0 && view.width > 0
        && (!fullscreen || fullscreen.contains(this.player))
        && !this.player.classList.contains("ytp-player-minimized");

      if (!active) {
        this.clearSurface();
        return;
      }

      if (!this.watch.hasAttribute("data-yag-surface")) {
        this.watch.toggleAttribute("data-yag-relative", getComputedStyle(this.watch).position === "static");
        this.watch.setAttribute("data-yag-surface", "");
      }
      this.watch.toggleAttribute("data-yag-fullscreen", cinema);
      this.watch.toggleAttribute("data-yag-motion", allowsMotion());
      this.watch.toggleAttribute("data-yag-still", !allowsMotion());
      this.watch.toggleAttribute("data-yag-tone", settings.brightness !== 100);
      if (wasCinema && !cinema && this.hasFrame) {
        this.renderer?.paintCanvas();
        this.canvasPaintTime = performance.now();
      }

      // Only the panel tint changes, so the controls and text stay opaque.
      const coverage = (100 - settings.transparency * 0.94).toFixed(2);
      this.watch.style.setProperty("--yag-coverage", `${coverage}%`);
      this.watch.style.setProperty("--yag-intensity", String(settings.intensity / 100));
      this.watch.style.setProperty("--yag-brightness", String(settings.brightness / 100));

      if (this.canvas && !cinema) {
        const padding = Math.round(Math.max(112, Math.min(232, rect.width * 0.25)));
        const x = rect.left - view.left - this.watch.clientLeft;
        const y = rect.top - view.top - this.watch.clientTop;
        const left = Math.max(0, Math.round(x - padding));
        const top = Math.max(0, Math.round(y - padding * 0.86));
        const right = Math.min(this.watch.clientWidth, Math.round(x + rect.width + padding));
        const bottom = Math.min(this.watch.clientHeight, Math.round(y + rect.height + padding * 1.28));

        this.canvas.style.left = `${left}px`;
        this.canvas.style.top = `${top}px`;
        this.canvas.style.width = `${Math.max(1, right - left)}px`;
        this.canvas.style.height = `${Math.max(1, bottom - top)}px`;
        this.canvas.style.setProperty("--yag-blur", `${Math.round(12 + padding * 0.06)}px`);
        // Begin the fade outside the player even when the watch layout clips one side.
        for (const [side, distance] of [
          ["left", x - left],
          ["right", right - x - rect.width],
          ["top", y - top],
          ["bottom", bottom - y - rect.height],
        ]) {
          this.canvas.style.setProperty(`--yag-fade-${side}`, `${Math.max(12, Math.round(distance * 0.84))}px`);
        }
      }

      if (settings.intensity > 0 && !this.unavailable) {
        this.sides?.layout(rect, allowsMotion() ? this.renderer?.bars : null,
          fullscreen, cinema && settings.fullGlow, settings.flipMode);
        if (this.hasFrame) this.sides?.paint(this.renderer, this.lastVideoTime, allowsMotion());
      } else {
        this.sides?.hide();
      }
      this.updateAmbientVisibility();
    }

    updateAmbientVisibility() {
      const quiet = settings.intensity === 0 && this.video && !this.unavailable;
      this.watch?.toggleAttribute("data-yag-video", this.surfaceVisible() && (this.hasFrame || quiet));
    }

    clearSurface() {
      this.sides?.hide();
      if (!this.watch?.hasAttribute("data-yag-surface")) return;

      for (const name of ["data-yag-video", "data-yag-surface", "data-yag-relative", "data-yag-fullscreen",
        "data-yag-motion", "data-yag-still", "data-yag-tone"]) {
        this.watch.removeAttribute(name);
      }
      this.watch.style.removeProperty("--yag-coverage");
      this.watch.style.removeProperty("--yag-intensity");
      this.watch.style.removeProperty("--yag-brightness");
    }

    shouldSample() {
      return this.surfaceVisible() && !this.unavailable && this.video?.isConnected
        && isWatchPage() && !document.hidden
        && settings.enabled && settings.intensity > 0 && !this.buffering
        && (allowsMotion() || !this.hasFrame) && !this.player.classList.contains("ad-showing")
        && !this.video.paused && !this.video.ended && !this.video.seeking
        && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    }

    refreshPlayback() {
      if (this.video?.mediaKeys && !this.unavailable) this.useFallback();
      if (!this.shouldSample()) {
        this.stopSampling();
      } else if (!this.timer && this.videoFrame === null) {
        this.requestSample();
      }
    }

    requestSample() {
      if (!this.shouldSample()) return;
      if (typeof this.video.requestVideoFrameCallback === "function"
        && typeof this.video.cancelVideoFrameCallback === "function") {
        this.videoFrame = this.video.requestVideoFrameCallback((now, { mediaTime, expectedDisplayTime }) => {
          this.videoFrame = null;
          this.sample(now, mediaTime, true, Number.isFinite(expectedDisplayTime) ? expectedDisplayTime : now);
        });
      } else {
        this.sample(performance.now(), this.video.currentTime);
      }
    }

    sample(now, mediaTime, frameDriven = false, displayTime = now) {
      if (!this.shouldSample()) return;
      if (frameDriven && this.sides?.detailVisible && displayTime + 0.75 < this.nextDetailTime) {
        this.requestSample();
        return;
      }
      const started = performance.now();
      const cinema = this.watch.hasAttribute("data-yag-fullscreen");
      if (mediaTime !== this.lastVideoTime) {
        if (!this.hasFrame || !this.sides?.detailVisible || now - this.colorSampleTime >= 110) {
          const previousBars = this.renderer.bars;
          const paintCanvas = !cinema && now - this.canvasPaintTime >= 110;
          try {
            if (!this.renderer.draw(this.video, now, paintCanvas, allowsMotion())) {
              this.useFallback();
              return;
            }
          } catch {
            // Chrome can prevent canvas access for protected media.
            this.useFallback();
            return;
          }
          this.colorSampleTime = now;
          if (paintCanvas) this.canvasPaintTime = now;
          if (this.renderer.bars !== previousBars) {
            this.sides?.layout(this.player.getBoundingClientRect(), this.renderer.bars,
              document.fullscreenElement, cinema && settings.fullGlow, settings.flipMode);
          }
        }
        this.lastVideoTime = mediaTime;
        this.sides?.paint(this.renderer, mediaTime, allowsMotion());
        if (!this.hasFrame) {
          this.hasFrame = true;
          this.updateAmbientVisibility();
        }
      }

      if (!allowsMotion()) return;

      const elapsed = Math.max(0, performance.now() - started);
      const detailInterval = 1000 / (settings.fps === "source" ? 60 : Number(settings.fps));
      if (frameDriven && this.sides?.detailVisible) {
        // Keep the cadence anchored so a 24 FPS limit on a 60 FPS
        // source alternates between gaps of two and three frames.
        const interval = Math.min(180, Math.max(detailInterval, elapsed * 5));
        const phase = this.nextDetailTime;
        this.nextDetailTime = interval === detailInterval && Number.isFinite(phase) && displayTime - phase < interval
          ? phase + interval : displayTime + interval;
        this.requestSample();
        return;
      }
      const interval = Math.min(180, Math.max(this.sides?.detailVisible ? detailInterval : sampleInterval, elapsed * 5,
        cinema && !this.sides?.visible ? 96 : 0));
      this.timer = setTimeout(() => {
        this.timer = 0;
        this.requestSample();
      }, Math.max(0, interval - elapsed));
    }

    stopSampling() {
      clearTimeout(this.timer);
      this.timer = 0;
      this.nextDetailTime = -Infinity;
      if (this.videoFrame !== null) {
        this.video.cancelVideoFrameCallback(this.videoFrame);
        this.videoFrame = null;
      }
    }

    releasePlayer() {
      this.stopSampling();
      this.resize.disconnect();
      this.playerChanges.disconnect();
      this.playback?.abort();
      this.canvas?.remove();
      this.clearSurface();
      this.sides?.clear();
      this.playback = null;
      this.canvas = null;
      this.renderer = null;
      this.sides = null;
      this.hasFrame = false;
      this.unavailable = false;
      this.buffering = false;
      this.lastVideoTime = null;
      this.canvasPaintTime = -Infinity;
      this.colorSampleTime = -Infinity;
    }

    dispose() {
      this.events.abort();
      this.layoutChanges.disconnect();
      cancelAnimationFrame(this.frame);
      this.releasePlayer();
    }

    status() {
      if (!this.surfaceVisible()) return document.fullscreenElement ? "fullscreenUnavailable" : "waiting";
      if (this.watch?.hasAttribute("data-yag-video")) {
        if (!settings.intensity) return "zero";
        if (!allowsMotion()) return "still";
        if (!this.watch.hasAttribute("data-yag-fullscreen")) return "video";
        return this.sides?.visible ? "cinema" : "fullscreenFilled";
      }
      if (allowsMotion() && nativeAmbientVisible(this.watch)) return "native";
      return this.unavailable ? "panels" : "waiting";
    }
  }

  function reconcile() {
    if (leavingDocument || !settingsLoaded) return;

    if (!settings.enabled || !isWatchPage()) {
      session?.dispose();
      session = null;
      return;
    }

    const id = watchVideoId();
    if (session?.id !== id) {
      session?.dispose();
      session = new WatchSession(id);
    } else {
      session.sync();
    }
  }

  // YouTube reuses a document for recommendations, Home and Shorts.
  for (const name of ["yt-navigate-finish", "yt-page-data-updated"]) {
    document.addEventListener(name, reconcile);
  }
  window.navigation?.addEventListener("currententrychange", reconcile);
  window.addEventListener("popstate", reconcile);
  reducedMotion?.addEventListener("change", reconcile);
  window.addEventListener("pagehide", () => {
    leavingDocument = true;
    session?.dispose();
    session = null;
  });
  window.addEventListener("pageshow", () => {
    leavingDocument = false;
    reconcile();
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== AmbientGlassSettings.statusMessage) return;
    const status = !settingsLoaded ? "waiting"
      : !settings.enabled ? "off"
      : !isWatchPage() ? "outside"
      : session?.status() ?? "waiting";
    respond({ status });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    const updated = { ...settings };
    for (const name of Object.keys(AmbientGlassSettings.defaults)) {
      if (Object.hasOwn(changes, name)) updated[name] = changes[name].newValue;
    }
    const previousFps = settings.fps;
    settings = AmbientGlassSettings.normalize(updated);
    if (previousFps !== settings.fps) session?.stopSampling();
    reconcile();
  });

  storage.get(AmbientGlassSettings.storageKeys).then((values) => {
    settings = AmbientGlassSettings.normalize(values);
    settingsLoaded = true;
    reconcile();
  }).catch(() => {
    // With storage unavailable there is no reliable persisted enable state.
  });
})();
