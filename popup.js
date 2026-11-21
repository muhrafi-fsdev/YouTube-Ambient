(() => {
  "use strict";

  const { defaults, storageKeys, normalize, statusMessage } = AmbientGlassSettings;
  const controls = document.getElementById("controls");
  const enabled = document.getElementById("enabled");
  const switchLabel = document.getElementById("switch-label");
  const status = document.getElementById("status");
  const reset = document.getElementById("reset");
  const fullGlow = document.getElementById("full-glow");
  const motion = document.getElementById("motion");
  const flipMode = document.getElementById("flip-mode");
  const fps = document.getElementById("fps");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const ranges = ["intensity", "transparency", "brightness"].map((name) => ({
    name,
    input: document.getElementById(name),
    output: document.getElementById(`${name}-value`),
  }));
  const messages = {
    waiting: "Putar video untuk menyalakan cahaya.",
    video: "Mengikuti warna video.",
    still: "Ambient statis.",
    zero: "Cahaya diatur ke 0%.",
    native: "Memakai Ambient Mode YouTube.",
    panels: "Cahaya tidak tersedia. Panel tetap aktif.",
    cinema: "Ambient aktif di fullscreen.",
    fullscreenFilled: "Gambar sudah memenuhi layar.",
    fullscreenUnavailable: "Ambient tidak tersedia di fullscreen ini.",
    off: "Efek dimatikan.",
    outside: "Buka video YouTube untuk melihat efek.",
  };

  let saved = defaults;
  let statusRequest = 0;
  let writeError = false;

  function render() {
    enabled.checked = saved.enabled;
    fullGlow.checked = saved.fullGlow;
    motion.checked = saved.motion && !reducedMotion?.matches;
    motion.disabled = Boolean(reducedMotion?.matches);
    flipMode.value = saved.flipMode;
    fps.value = saved.fps;
    fps.disabled = !motion.checked;
    switchLabel.textContent = saved.enabled ? "On" : "Off";
    for (const { name, input, output } of ranges) {
      input.value = saved[name];
      input.setAttribute("aria-valuetext", `${saved[name]} persen`);
      output.value = `${saved[name]}%`;
    }
  }

  function showStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  async function refreshStatus() {
    const request = ++statusRequest;
    if (writeError) return;
    if (!saved.enabled) {
      showStatus(messages.off);
      return;
    }

    let state = "outside";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        const response = await chrome.tabs.sendMessage(tab.id, { type: statusMessage });
        state = response?.status;
      }
    } catch {
      // Tabs outside YouTube and tabs opened before installation lack a receiver.
    }

    if (request === statusRequest && !writeError) {
      showStatus(messages[state] ?? messages.outside);
    }
  }

  async function save(values) {
    saved = normalize({ ...saved, ...values });
    render();
    try {
      await chrome.storage.local.set(values);
      writeError = false;
      refreshStatus();
    } catch {
      writeError = true;
      showStatus("Pengaturan gagal disimpan.");
    }
  }

  enabled.addEventListener("change", () => save({ enabled: enabled.checked }));
  fullGlow.addEventListener("change", () => save({ fullGlow: fullGlow.checked }));
  motion.addEventListener("change", () => save({ motion: motion.checked }));
  flipMode.addEventListener("change", () => save({ flipMode: flipMode.value }));
  fps.addEventListener("change", () => save({ fps: fps.value }));
  reducedMotion?.addEventListener("change", () => {
    render();
    refreshStatus();
  });
  for (const { name, input } of ranges) {
    input.addEventListener("input", () => save({ [name]: Number(input.value) }));
  }
  reset.addEventListener("click", () => save(defaults));

  chrome.storage.local.get(storageKeys).then((values) => {
    saved = normalize(values);
    render();
    controls.disabled = false;
    refreshStatus();
    const timer = setInterval(refreshStatus, 800);
    window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  }).catch(() => showStatus("Pengaturan gagal dimuat."));
})();
