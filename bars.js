"use strict";

const AmbientGlassPillarbox = (() => {
  function measure(data, width, height, horizontal, blackLimit, refine = false) {
    const length = horizontal ? width : height;
    const crossLength = horizontal ? height : width;

    function pixel(edge, cross) {
      return 4 * (horizontal ? cross * width + edge : edge * width + cross);
    }

    function darkLine(edge, allowFringe = false) {
      for (let cross = 0; cross < crossLength; cross += 1) {
        const i = pixel(edge, cross);
        if (data[i + 3] < 250) return false;
        const peak = Math.max(data[i], data[i + 1], data[i + 2]);
        if (peak <= blackLimit) continue;
        const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (!allowFringe || peak > 48 || luminance > blackLimit) return false;
      }
      return true;
    }

    function brightLine(edge, threshold) {
      let bright = 0;
      for (let cross = 0; cross < crossLength; cross += 1) {
        const i = pixel(edge, cross);
        if (Math.max(data[i], data[i + 1], data[i + 2]) >= threshold) bright += 1;
      }
      return bright >= crossLength * 0.4;
    }

    const limit = Math.floor(length * 0.26);
    let near = 0;
    let far = 0;
    while (near < limit && darkLine(near)) near += 1;
    while (far < limit && darkLine(length - far - 1)) far += 1;

    const minimum = Math.max(1, Math.floor(length * 0.018));
    if (near < minimum || far < minimum || near === limit || far === limit
      || Math.abs(near - far) > Math.max(1, length * 0.015)) return null;

    if (refine) {
      // Decoding can tint the last black line next to a bright picture.
      // Include at most one near-black line with a strong transition after it.
      if (darkLine(near, true) && brightLine(near + 1, 56)) near += 1;
      if (darkLine(length - far - 1, true) && brightLine(length - far - 2, 56)) far += 1;
    }

    // Confirm at least one sharp transition from the paired bars into the picture.
    const reach = Math.max(1, Math.ceil(length * 0.018));
    for (let step = 0; step < reach; step += 1) {
      for (const edge of [near + step, length - far - step - 1]) {
        if (brightLine(edge, 32)) return { near: near / length, far: far / length };
      }
    }
    return null;
  }

  function createAxis(horizontal) {
    let probe = null;
    let context = null;
    let after = 0;
    let previous = null;
    let confirmed = null;
    let failed = false;

    function resetMeasurements() {
      previous = confirmed = null;
      after = 0;
    }

    return {
      update(video, data, width, height, now, probeBudget) {
        const coarse = measure(data, width, height, horizontal, 13);
        const length = horizontal ? width : height;
        if (!coarse) {
          resetMeasurements();
          return null;
        }
        if (confirmed && (confirmed.near > coarse.near + 1 / length
          || confirmed.far > coarse.far + 1 / length)) resetMeasurements();

        const naturalLength = horizontal ? video.videoWidth : video.videoHeight;
        if (failed || now < after || !(naturalLength > length) || !probeBudget.available) return confirmed;

        const scanLength = Math.min(naturalLength, 1024);
        const probeWidth = horizontal ? scanLength : 16;
        const probeHeight = horizontal ? 16 : scanLength;
        if (!probe) {
          probe = document.createElement("canvas");
          context = probe.getContext("2d", { willReadFrequently: true });
        }
        if (!context) {
          failed = true;
          return null;
        }
        probeBudget.available = false;
        if (probe.width !== probeWidth || probe.height !== probeHeight) {
          probe.width = probeWidth;
          probe.height = probeHeight;
          resetMeasurements();
        }
        let candidate;
        try {
          context.clearRect(0, 0, probeWidth, probeHeight);
          context.drawImage(video, 0, 0, probeWidth, probeHeight);
          const pixels = context.getImageData(0, 0, probeWidth, probeHeight).data;
          candidate = measure(pixels, probeWidth, probeHeight, horizontal, 8, true);
        } catch {
          failed = true;
          resetMeasurements();
          return null;
        }

        if (candidate && previous && Math.abs(candidate.near - previous.near) <= 2 / scanLength
          && Math.abs(candidate.far - previous.far) <= 2 / scanLength) {
          const near = Math.min(candidate.near, previous.near);
          const far = Math.min(candidate.far, previous.far);
          if (confirmed?.near !== near || confirmed?.far !== far) confirmed = { near, far };
        } else {
          confirmed = null;
        }
        previous = candidate;
        after = now + (confirmed ? 1800 : candidate ? 160 : 550);
        return confirmed;
      },

      reset() {
        if (probe) probe.width = 0;
        resetMeasurements();
        failed = false;
      },
    };
  }

  function create() {
    const horizontal = createAxis(true);
    const vertical = createAxis(false);
    let lastX = null;
    let lastY = null;
    let bars = null;

    return {
      update(video, data, width, height, now) {
        // At most one larger readback per sampled frame.
        const probeBudget = { available: true };
        const x = horizontal.update(video, data, width, height, now, probeBudget);
        const y = vertical.update(video, data, width, height, now, probeBudget);
        if (x !== lastX || y !== lastY) {
          bars = x || y ? {
            left: x?.near ?? 0, right: x?.far ?? 0,
            top: y?.near ?? 0, bottom: y?.far ?? 0,
          } : null;
          lastX = x;
          lastY = y;
        }
        return bars;
      },
      reset() {
        horizontal.reset();
        vertical.reset();
        lastX = lastY = bars = null;
      },
    };
  }

  return { create };
})();
