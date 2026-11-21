"use strict";

const AmbientGlassSides = (() => {
  const theaterSelector = "#player-theater-container, #full-bleed-container, #player-full-bleed-container";
  const edges = ["left", "right", "top", "bottom"];

  function positionOffset(value, freeSpace) {
    if (value === "center") return freeSpace / 2;
    if (value === "left" || value === "top") return 0;
    if (value === "right" || value === "bottom") return freeSpace;
    if (/^-?\d+(?:\.\d+)?%$/.test(value)) return freeSpace * parseFloat(value) / 100;
    if (/^-?\d+(?:\.\d+)?px$/.test(value)) return parseFloat(value);
    return NaN;
  }

  function pictureBounds(video, bars) {
    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height || !video.videoWidth || !video.videoHeight) return null;

    const { objectFit, objectPosition } = getComputedStyle(video);
    let { width, height } = rect;
    let x = 0;
    let y = 0;
    if (["contain", "scale-down", "none", "cover"].includes(objectFit)) {
      const scaleX = width / video.videoWidth;
      const scaleY = height / video.videoHeight;
      const scale = objectFit === "none" ? 1
        : objectFit === "cover" ? Math.max(scaleX, scaleY)
        : Math.min(scaleX, scaleY, objectFit === "scale-down" ? 1 : Infinity);
      width = video.videoWidth * scale;
      height = video.videoHeight * scale;
      const [horizontal, vertical = "50%", ...rest] = (objectPosition || "50% 50%").split(/\s+/);
      x = positionOffset(horizontal, rect.width - width);
      y = positionOffset(vertical, rect.height - height);
      if (rest.length || !Number.isFinite(x) || !Number.isFinite(y)) {
        ({ width, height } = rect);
        x = y = 0;
      }
    }

    const left = rect.left + Math.max(0, x + width * (bars?.left ?? 0));
    const top = rect.top + Math.max(0, y + height * (bars?.top ?? 0));
    const right = rect.left + Math.min(rect.width, x + width * (1 - (bars?.right ?? 0)));
    const bottom = rect.top + Math.min(rect.height, y + height * (1 - (bars?.bottom ?? 0)));
    return {
      left, top, width: right - left, height: bottom - top,
      sourceX: (left - rect.left - x) / width,
      sourceY: (top - rect.top - y) / height,
      sourceWidth: (right - left) / width,
      sourceHeight: (bottom - top) / height,
    };
  }

  function extendedAxis(boxStart, boxSize, pixels, start, size, sourceStart, sourceSize, limit, span, flipMode) {
    const end = start + size;
    const flipEdge = flipMode === "edge";
    const flipAxis = flipMode === "axis";
    const nearGap = Math.max(1, start - limit);
    const farGap = Math.max(1, limit + span - end);
    const band = (gap) => Math.min(sourceSize * 0.16, Math.max(1, gap * sourceSize / size));
    const stops = [boxStart, start, end, boxStart + boxSize]
      .filter((point) => point >= boxStart && point <= boxStart + boxSize);
    const sourceAt = (point, near, far) => {
      if (near) {
        const progress = Math.max(0, Math.min(1, (point - limit) / nearGap));
        return sourceStart + band(nearGap) * (flipEdge ? 1 - progress : progress);
      }
      if (far) {
        const progress = Math.max(0, Math.min(1, (point - end) / farGap));
        return sourceStart + sourceSize - band(farGap) * (flipEdge ? progress : 1 - progress);
      }
      return sourceStart + (point - start) * sourceSize / size;
    };
    const segments = [];
    for (let i = 1; i < stops.length; i += 1) {
      const from = stops[i - 1];
      const to = stops[i];
      const dest = Math.round((from - boxStart) * pixels / boxSize);
      const destSize = Math.round((to - boxStart) * pixels / boxSize) - dest;
      if (!destSize) continue;
      const a = sourceAt(from, to <= start, from >= end);
      const b = sourceAt(to, to <= start, from >= end);
      if (a !== b) {
        segments.push({
          source: Math.min(a, b), size: Math.abs(a - b),
          dest: flipAxis ? pixels - dest - destSize : dest, destSize, flipped: (a > b) !== flipAxis,
        });
      }
    }
    return segments;
  }

  function create(watch, player, video) {
    let strips = [];
    let picture = null;
    let extent = null;
    let direction = "none";
    let frame = null;
    let frameContext = null;
    let frameTime = null;
    let detailUnavailable = false;

    function replaceStrips(next) {
      for (const strip of strips) {
        if (!next.includes(strip)) strip.element.remove();
      }
      strips = next;
    }

    function layOutZone(next, anchor, frame, inner, fullGlow = false) {
      if (frame.width <= 0 || frame.height <= 0) return;
      const right = frame.left + frame.width;
      const bottom = frame.top + frame.height;
      let innerLeft = Math.max(frame.left, inner.left);
      let innerRight = Math.min(right, inner.left + inner.width);
      let innerTop = Math.max(frame.top, inner.top);
      let innerBottom = Math.min(bottom, inner.top + inner.height);
      if (innerLeft >= innerRight || innerTop >= innerBottom) return;

      const halo = {};
      if (fullGlow) {
        const depth = Math.min(64, (innerRight - innerLeft) / 8, (innerBottom - innerTop) / 8,
          Math.min(frame.width, frame.height) * 0.055);
        if (innerLeft - frame.left < 0.5) {
          halo.left = true;
          innerLeft += depth;
        }
        if (right - innerRight < 0.5) {
          halo.right = true;
          innerRight -= depth;
        }
        if (innerTop - frame.top < 0.5) {
          halo.top = true;
          innerTop += depth;
        }
        if (bottom - innerBottom < 0.5) {
          halo.bottom = true;
          innerBottom -= depth;
        }
      }

      // A static wrapper can host the strip without changing its native layout.
      let containingBlock = anchor;
      while (containingBlock !== watch && getComputedStyle(containingBlock).position === "static") {
        containingBlock = containingBlock.parentElement;
      }
      const origin = containingBlock.getBoundingClientRect();
      const x = origin.left + containingBlock.clientLeft;
      const y = origin.top + containingBlock.clientTop;

      const boxes = [
        ["left", frame.left, frame.top, innerLeft - frame.left, frame.height],
        ["right", innerRight, frame.top, right - innerRight, frame.height],
        ["top", innerLeft, frame.top, innerRight - innerLeft, innerTop - frame.top],
        ["bottom", innerLeft, innerBottom, innerRight - innerLeft, bottom - innerBottom],
      ];
      for (const [side, left, top, width, height] of boxes) {
        if (width < 0.5 || height < 0.5) continue;

        let strip = strips.find((item) => item.anchor === anchor && item.side === side);
        if (!strip) {
          const element = document.createElement("div");
          element.setAttribute("data-yag-side", side);
          element.setAttribute("aria-hidden", "true");
          anchor.append(element);
          strip = { anchor, element, side };
        }
        strip.element.toggleAttribute("data-yag-halo", Boolean(halo[side]));
        strip.halo = Boolean(halo[side]);
        const box = { left, top, width, height };
        if (strip.image && Object.keys(box).some(key => box[key] !== strip.box[key])) {
          strip.image.segments = null;
          strip.image.paintedTime = null;
        }
        strip.box = box;
        Object.assign(strip.element.style, {
          left: `${left - x}px`,
          top: `${top - y}px`,
          width: `${width}px`,
          height: `${height}px`,
        });
        next.push(strip);
      }
    }

    function capture(mediaTime, moving) {
      if (frame && frameTime === mediaTime) return true;
      if (mediaTime === null || !video.videoWidth || !video.videoHeight) return false;
      if (!frame) {
        frame = document.createElement("canvas");
        frameContext = frame.getContext("2d", { alpha: false });
      }
      if (!frameContext) {
        detailUnavailable = true;
        return false;
      }
      const scale = Math.min(1, (moving ? 480 : 960) / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (frame.width !== width || frame.height !== height) {
        frame.width = width;
        frame.height = height;
        for (const strip of strips) {
          if (strip.image) strip.image.segments = null;
        }
      }
      frameContext.drawImage(video, 0, 0, width, height);
      frameTime = mediaTime;
      return true;
    }

    function paintImage(strip) {
      if (!strip.image) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return false;
        strip.element.append(canvas);
        strip.image = { canvas, context, paintedTime: null };
      }
      const { canvas, context } = strip.image;
      if (strip.image.paintedTime === frameTime) return true;
      const box = strip.box;
      const vertical = strip.side === "left" || strip.side === "right";
      const scale = Math.min(1, 640 / Math.max(box.width, box.height));
      const width = Math.max(1, Math.min(vertical ? 156 : 640, Math.round(box.width * scale)));
      const height = Math.max(1, Math.min(vertical ? 640 : 156, Math.round(box.height * scale)));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (!strip.image.segments) {
        const horizontalFlip = direction === "horizontal" || direction === "both" ? "axis" : direction;
        const verticalFlip = direction === "vertical" || direction === "both" ? "axis" : direction;
        strip.image.segments = [
          extendedAxis(box.left, box.width, width, picture.left, picture.width,
            picture.sourceX * frame.width, picture.sourceWidth * frame.width, extent.left, extent.width, horizontalFlip),
          extendedAxis(box.top, box.height, height, picture.top, picture.height,
            picture.sourceY * frame.height, picture.sourceHeight * frame.height, extent.top, extent.height, verticalFlip),
        ];
      }
      const [xs, ys] = strip.image.segments;
      for (const x of xs) {
        for (const y of ys) {
          context.setTransform(x.flipped ? -1 : 1, 0, 0, y.flipped ? -1 : 1,
            x.dest + (x.flipped ? x.destSize : 0), y.dest + (y.flipped ? y.destSize : 0));
          context.drawImage(frame, x.source, y.source, x.size, y.size,
            0, 0, x.destSize, y.destSize);
        }
      }
      strip.image.paintedTime = frameTime;
      return true;
    }

    return {
      get visible() { return strips.length > 0; },
      get detailVisible() { return !detailUnavailable && strips.some((strip) => !strip.halo); },

      layout(playerBounds, bars, fullscreenElement, fullGlow, flipMode) {
        const next = [];
        const previous = picture;
        const previousExtent = extent;
        const directionChanged = direction !== flipMode;
        direction = flipMode;
        picture = pictureBounds(video, bars);
        extent = playerBounds;
        const pictureChanged = !previous || !picture
          || Object.keys(picture).some(key => picture[key] !== previous[key]);

        if (picture?.width > 0 && picture.height > 0 && !player.classList.contains("ad-showing")) {
          const surface = video.closest(".html5-video-container");
          const anchor = surface && player.contains(surface) ? surface : player;
          layOutZone(next, anchor, playerBounds, picture, fullGlow);

          let covered = playerBounds;
          for (let wrapper = player.parentElement; wrapper; wrapper = wrapper.parentElement) {
            if (fullscreenElement === player || !watch.contains(wrapper)) break;

            const theaterFrame = wrapper !== fullscreenElement && watch.hasAttribute("theater")
              && wrapper.id === "player-container-outer";
            if (wrapper === fullscreenElement || wrapper.matches(theaterSelector) || theaterFrame) {
              const frame = wrapper.getBoundingClientRect();
              if (frame.width > 0 && frame.height > 0) {
                // Some theater layouts put below-video rows inside this wrapper.
                const paintFrame = theaterFrame ? {
                  left: frame.left, width: frame.width,
                  top: Math.max(frame.top, covered.top),
                  height: Math.min(frame.top + frame.height, covered.top + covered.height)
                    - Math.max(frame.top, covered.top),
                } : frame;
                layOutZone(next, wrapper, paintFrame, covered);
                const left = Math.min(covered.left, frame.left);
                const top = Math.min(covered.top, paintFrame.top);
                const right = Math.max(covered.left + covered.width, frame.left + frame.width);
                const bottom = Math.max(covered.top + covered.height, paintFrame.top + paintFrame.height);
                covered = { left, top, width: right - left, height: bottom - top };
              }
            }
            if (wrapper === fullscreenElement || wrapper === watch) break;
          }
          extent = covered;
        }

        const extentChanged = !previousExtent || Object.keys(extent).some(key => extent[key] !== previousExtent[key]);
        for (const strip of next) {
          if (strip.image && (pictureChanged || extentChanged || directionChanged)) {
            strip.image.paintedTime = null;
            strip.image.segments = null;
          }
        }
        replaceStrips(next);
      },

      paint(renderer, mediaTime, moving) {
        let captured = false;
        if (this.detailVisible) {
          try {
            captured = capture(mediaTime, moving);
          } catch {
            // Keep a color fallback if the tab cannot render the sampled picture.
          }
        }
        for (const edge of edges) {
          let gradient;
          for (const strip of strips) {
            if (strip.side !== edge) continue;
            let hasImage = false;
            if (captured && !strip.halo) {
              try {
                hasImage = paintImage(strip);
              } catch {
                // A detached or invalid canvas should not interrupt playback.
              }
            }
            if (strip.image && strip.image.canvas.hidden === hasImage) {
              strip.image.canvas.hidden = !hasImage;
            }
            gradient ??= renderer.edgeGradient(edge);
            if (gradient !== strip.gradient) {
              strip.element.style.backgroundImage = gradient;
              strip.gradient = gradient;
            }
          }
        }
      },

      hide() {
        replaceStrips([]);
      },

      clear() {
        replaceStrips([]);
        frame = frameContext = frameTime = null;
        detailUnavailable = false;
      },
    };
  }

  return { create };
})();
