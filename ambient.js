"use strict";

const AmbientGlassFrame = (() => {
  const width = 32;
  const height = 18;

  function create(canvas) {
    const sample = document.createElement("canvas");
    sample.width = canvas.width = width;
    sample.height = canvas.height = height;

    // The ambient sample is 576 pixels. Luminance becomes opacity so dark scenes
    // fade out on light and dark themes, including completely black frames.
    const source = sample.getContext("2d", { willReadFrequently: true });
    const target = canvas.getContext("2d");
    if (!source || !target) return null;

    const smoothed = new Float32Array(width * height * 4);
    const output = target.createImageData(width, height);
    const detector = AmbientGlassPillarbox.create();
    const gradients = new Map();
    let lastSample = null;
    let bars = null;
    let sceneAlpha = 0;
    let sceneR = 0;
    let sceneG = 0;
    let sceneB = 0;

    function paintCanvas() {
      target.putImageData(output, 0, 0);
    }

    function draw(video, now, paint = true, detectBars = true) {
      source.clearRect(0, 0, width, height);
      source.drawImage(video, 0, 0, width, height);
      const { data } = source.getImageData(0, 0, width, height);
      const weight = lastSample === null
        ? 1
        : 1 - Math.exp(-Math.max(0, now - lastSample) / 90);
      let hasPixels = false;
      sceneAlpha = sceneR = sceneG = sceneB = 0;

      for (let i = 0; i < data.length; i += 4) {
        hasPixels ||= data[i + 3] > 0;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const peak = Math.max(r, g, b);
        const chroma = (peak - Math.min(r, g, b)) / 255;
        const light = Math.max(luminance, peak * 0.93) / 255;
        const level = Math.max(0, (light - 0.055) / 0.945);
        // Bring up midtones and saturated light. Limit neutral highlights
        // so a bright white scene is less likely to wash out the text.
        const strength = level * level * (2.15 - 1.15 * level);
        const alpha = data[i + 3] * strength * (0.63 + 0.37 * chroma);

        // Smooth brightness independently of hue so it doesn't dip when two
        // bright scenes on opposite ends of the spectrum blend together.
        for (let channel = 0; channel < 4; channel += 1) {
          const index = i + channel;
          const value = channel === 3 ? alpha : data[index];
          smoothed[index] += (value - smoothed[index]) * weight;
          output.data[index] = smoothed[index];
        }
        const visibleAlpha = output.data[i + 3];
        sceneAlpha += visibleAlpha;
        sceneR += output.data[i] * visibleAlpha;
        sceneG += output.data[i + 1] * visibleAlpha;
        sceneB += output.data[i + 2] * visibleAlpha;
      }

      if (!hasPixels) return false;
      bars = detectBars ? detector.update(video, data, width, height, now) : null;
      gradients.clear();
      if (paint) paintCanvas();
      lastSample = now;
      return true;
    }

    return {
      draw,
      paintCanvas,
      get bars() { return bars; },
      edgeGradient(side) {
        if (gradients.has(side)) return gradients.get(side);
        const horizontal = side === "left" || side === "right";
        const reverse = side === "right" || side === "bottom";
        const left = Math.ceil((bars?.left ?? 0) * width);
        const right = width - Math.ceil((bars?.right ?? 0) * width);
        const top = Math.ceil((bars?.top ?? 0) * height);
        const bottom = height - Math.ceil((bars?.bottom ?? 0) * height);
        const near = horizontal ? left : top;
        const far = horizontal ? right : bottom;
        const crossStart = horizontal ? top : left;
        const crossEnd = horizontal ? bottom : right;
        const stops = [];
        const step = Math.ceil((crossEnd - crossStart) / 8);
        for (let start = crossStart; start < crossEnd; start += step) {
          let r = 0;
          let g = 0;
          let b = 0;
          let alpha = 0;
          let totalWeight = 0;

          for (let offset = 0; offset < far - near; offset += 1) {
            const edge = reverse ? far - offset - 1 : near + offset;
            const weight = offset < 7 ? 13 - offset : 1;

            for (let cross = start; cross < Math.min(start + step, crossEnd); cross += 1) {
              const i = 4 * (horizontal ? cross * width + edge : edge * width + cross);
              const light = weight * output.data[i + 3];
              totalWeight += weight;
              r += output.data[i] * light;
              g += output.data[i + 1] * light;
              b += output.data[i + 2] * light;
              alpha += light;
            }
          }

          // Share some of the scene's light across all four sides so
          // isolated dark patches near a picture edge don't leave holes.
          const local = 0.72 / totalWeight;
          const spill = 0.28 / (width * height);
          const light = alpha * local + sceneAlpha * spill;
          const opacity = Math.min(1, light / 255 * 1.58);
          const color = light ? [
            Math.round((r * local + sceneR * spill) / light),
            Math.round((g * local + sceneG * spill) / light),
            Math.round((b * local + sceneB * spill) / light),
          ].join(" ") : "0 0 0";
          stops.push(`rgb(${color} / ${opacity.toFixed(3)})`);
        }
        const gradient = `linear-gradient(${horizontal ? "to bottom" : "to right"}, ${stops.join(", ")})`;
        gradients.set(side, gradient);
        return gradient;
      },
      reset() {
        // Resetting the scratch bitmap also clears its origin state at a
        // media change. The source video's URL and CORS settings are untouched.
        sample.width = width;
        target.clearRect(0, 0, width, height);
        lastSample = null;
        bars = null;
        gradients.clear();
        detector.reset();
      },
    };
  }

  return { create };
})();
