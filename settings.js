"use strict";

const AmbientGlassSettings = (() => {
  const defaults = Object.freeze({
    enabled: true,
    intensity: 92,
    transparency: 86,
    brightness: 100,
    fullGlow: false,
    motion: false,
    fps: "source",
    flipMode: "none",
  });
  const storageKeys = [...Object.keys(defaults), "flip"];
  const fpsOptions = ["source", "30", "24"];
  const flipOptions = ["none", "edge", "horizontal", "vertical", "both"];

  function percent(value, fallback) {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.round(Math.max(0, Math.min(100, value)))
      : fallback;
  }

  function normalize(values) {
    return {
      enabled: typeof values.enabled === "boolean" ? values.enabled : defaults.enabled,
      intensity: percent(values.intensity, defaults.intensity),
      transparency: percent(values.transparency, defaults.transparency),
      brightness: Math.max(40, percent(values.brightness, defaults.brightness)),
      fullGlow: values.fullGlow === true,
      motion: values.motion === true,
      fps: fpsOptions.includes(values.fps) ? values.fps : defaults.fps,
      flipMode: flipOptions.includes(values.flipMode) ? values.flipMode : values.flip === true ? "edge" : defaults.flipMode,
    };
  }

  return { defaults, storageKeys, normalize, statusMessage: "youtube-ambient-glass:status" };
})();
