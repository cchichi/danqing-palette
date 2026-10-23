/*
 * danqing quantize — 颜色量化（k-means++）与 CIE94 最近邻匹配
 * 纯函数模块，无依赖。暴露为 window.DQ
 */
(function () {
  'use strict';

  /* ---------- 色彩空间 ---------- */

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  // sRGB -> CIELAB (D65)
  function rgb2lab(r, g, b) {
    const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
    let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
    let y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722);
    let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
    x = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
    y = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
    z = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  // CIE94 色差（kL=1, 图形 arts 参数）
  function dist94(lab1, lab2) {
    const L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    const L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
    const dL = L1 - L2;
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const dC = C1 - C2;
    const da = a1 - a2, db = b1 - b2;
    const dH2 = Math.max(0, da * da + db * db - dC * dC);
    const sC = 1 + 0.045 * C1;
    const sH = 1 + 0.015 * C1;
    const v1 = dL, v2 = dC / sC, v3 = dH2 / (sH * sH);
    return Math.sqrt(v1 * v1 + v2 * v2 + v3);
  }

  /* ---------- k-means++ 量化 ---------- */

  // mulberry32 固定种子伪随机：同一张图每次取色结果一致
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rngFrom(pixels) {
    let h = 2166136261;
    for (let i = 0; i < pixels.length; i += 97) {
      h = Math.imul(h ^ pixels[i], 16777619);
    }
    return makeRng(h);
  }

  // pixels: RGBA 序列（跳过透明像素），返回最多 maxKeep 个 [{rgb, weight}]，weight 之和为 1
  function extractPalette(pixels, k, iters, maxKeep) {
    k = k || 8;
    iters = iters || 14;
    maxKeep = maxKeep || 6;
    const n = pixels.length >> 2;
    const pts = []; // 有效像素索引
    for (let i = 0; i < n; i++) {
      if (pixels[i * 4 + 3] > 200) pts.push(i);
    }
    if (pts.length === 0) return [];
    const N = pts.length;
    const data = new Float32Array(N * 3);
    for (let j = 0; j < N; j++) {
      const i = pts[j] * 4;
      data[j * 3] = pixels[i];
      data[j * 3 + 1] = pixels[i + 1];
      data[j * 3 + 2] = pixels[i + 2];
    }

    // k-means++ 初始化
    const centers = new Float32Array(k * 3);
    const rng = rngFrom(pixels);
    let first = (rng() * N) | 0;
    centers[0] = data[first * 3];
    centers[1] = data[first * 3 + 1];
    centers[2] = data[first * 3 + 2];
    const dist2 = new Float32Array(N).fill(Infinity);
    for (let c = 1; c < k; c++) {
      let sum = 0;
      const pc0 = centers[(c - 1) * 3], pc1 = centers[(c - 1) * 3 + 1], pc2 = centers[(c - 1) * 3 + 2];
      for (let j = 0; j < N; j++) {
        const dr = data[j * 3] - pc0, dg = data[j * 3 + 1] - pc1, db = data[j * 3 + 2] - pc2;
        const d = dr * dr + dg * dg + db * db;
        if (d < dist2[j]) dist2[j] = d;
        sum += dist2[j];
      }
      let target = rng() * sum, acc = 0, pick = N - 1;
      for (let j = 0; j < N; j++) {
        acc += dist2[j];
        if (acc >= target) { pick = j; break; }
      }
      centers[c * 3] = data[pick * 3];
      centers[c * 3 + 1] = data[pick * 3 + 1];
      centers[c * 3 + 2] = data[pick * 3 + 2];
    }

    // 迭代
    const assign = new Int32Array(N);
    for (let it = 0; it < iters; it++) {
      let moved = false;
      for (let j = 0; j < N; j++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const dr = data[j * 3] - centers[c * 3];
          const dg = data[j * 3 + 1] - centers[c * 3 + 1];
          const db = data[j * 3 + 2] - centers[c * 3 + 2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; best = c; }
        }
        if (assign[j] !== best) { assign[j] = best; moved = true; }
      }
      const acc = new Float64Array(k * 4);
      for (let j = 0; j < N; j++) {
        const c = assign[j];
        acc[c * 4] += data[j * 3];
        acc[c * 4 + 1] += data[j * 3 + 1];
        acc[c * 4 + 2] += data[j * 3 + 2];
        acc[c * 4 + 3]++;
      }
      for (let c = 0; c < k; c++) {
        if (acc[c * 4 + 3] > 0) {
          centers[c * 3] = acc[c * 4] / acc[c * 4 + 3];
          centers[c * 3 + 1] = acc[c * 4 + 1] / acc[c * 4 + 3];
          centers[c * 3 + 2] = acc[c * 4 + 2] / acc[c * 4 + 3];
        }
      }
      if (!moved && it > 1) break;
    }

    // 汇总簇
    const acc = new Float64Array(k * 4);
    for (let j = 0; j < N; j++) {
      const c = assign[j];
      acc[c * 4] += data[j * 3];
      acc[c * 4 + 1] += data[j * 3 + 1];
      acc[c * 4 + 2] += data[j * 3 + 2];
      acc[c * 4 + 3]++;
    }
    let clusters = [];
    for (let c = 0; c < k; c++) {
      const cnt = acc[c * 4 + 3];
      if (cnt > 0) clusters.push({
        rgb: [Math.round(acc[c * 4] / cnt), Math.round(acc[c * 4 + 1] / cnt), Math.round(acc[c * 4 + 2] / cnt)],
        count: cnt
      });
    }
    clusters.sort((a, b) => b.count - a.count);

    // 合并过近的簇（Lab 色差 < 5 视为同一色）
    const merged = [];
    for (const cl of clusters) {
      const lab = rgb2lab(cl.rgb[0], cl.rgb[1], cl.rgb[2]);
      const hit = merged.find(m => dist94(m._lab, lab) < 5);
      if (hit) {
        const total = hit.count + cl.count;
        for (let i = 0; i < 3; i++) hit.rgb[i] = Math.round((hit.rgb[i] * hit.count + cl.rgb[i] * cl.count) / total);
        hit._lab = rgb2lab(hit.rgb[0], hit.rgb[1], hit.rgb[2]);
        hit.count = total;
      } else {
        merged.push({ rgb: cl.rgb.slice(), count: cl.count, _lab: lab });
      }
    }

    // 只保留占比最大的前 maxKeep 个
    merged.sort((a, b) => b.count - a.count);
    const kept = merged.slice(0, maxKeep);
    const total = kept.reduce((s, m) => s + m.count, 0);
    return kept.map(m => ({
      rgb: m.rgb,
      hex: rgb2hex(m.rgb),
      weight: m.count / total
    }));
  }

  /* ---------- 传统色最近邻匹配 ---------- */

  let _tradLab = null;
  function tradWithLab() {
    if (!_tradLab) {
      _tradLab = window.TRADITIONAL_COLORS.map(c => ({
        c,
        lab: rgb2lab(c.rgb[0], c.rgb[1], c.rgb[2])
      }));
    }
    return _tradLab;
  }

  // 独占最近邻：按占比从大到小依次认领传统色，色名不重复
  // 返回 [{...传统色, weight, sourceRgb, sourceHex, dist}]
  function matchTraditional(palette) {
    const table = tradWithLab();
    const used = new Set();
    return palette.map(p => {
      const lab = rgb2lab(p.rgb[0], p.rgb[1], p.rgb[2]);
      const ranked = [];
      for (const t of table) {
        ranked.push({ t: t, d: dist94(lab, t.lab) });
      }
      ranked.sort((a, b) => a.d - b.d);
      const pick = ranked.find(r => !used.has(r.t.c.name)) || ranked[0];
      used.add(pick.t.c.name);
      return Object.assign({}, pick.t.c, {
        weight: p.weight,
        sourceRgb: p.rgb,
        sourceHex: p.hex,
        dist: Math.round(pick.d * 10) / 10
      });
    });
  }

  /* ---------- 工具 ---------- */

  function rgb2hex(rgb) {
    return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function luminance(rgb) {
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  window.DQ = {
    extractPalette: extractPalette,
    matchTraditional: matchTraditional,
    rgb2lab: rgb2lab,
    dist94: dist94,
    luminance: luminance,
    rgb2hex: rgb2hex
  };
})();
