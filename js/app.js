/*
 * 丹青取色 — 主逻辑：上传 / 取色 / 渲染色卡 / 导出
 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };

  var els = {
    dropzone: $('#dropzone'),
    file: $('#file'),
    samples: $('#samples'),
    result: $('#result'),
    preview: $('#preview'),
    paintingName: $('#painting-name'),
    palette: $('#palette'),
    paletteTitle: $('#palette-title'),
    btnCss: $('#btn-css'),
    btnJson: $('#btn-json'),
    btnPoster: $('#btn-poster'),
    size: $('#poster-size'),
    toast: $('#toast')
  };

  var current = { matched: null, painting: '' };

  /* ---------- 载入与取色 ---------- */

  function loadSrc(src, name) {
    var img = new Image();
    img.onload = function () { analyze(img, name || '未知画作'); };
    img.onerror = function () { toast('图片读取失败，换一张试试'); };
    img.src = src;
  }

  function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
    var reader = new FileReader();
    reader.onload = function () { loadSrc(reader.result, file.name.replace(/\.[^.]+$/, '')); };
    reader.readAsDataURL(file);
  }

  function analyze(img, name) {
    var MAX = 260;
    var scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var imageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      toast('无法读取图片像素，请直接上传图片文件');
      return;
    }
    var palette = DQ.extractPalette(imageData.data, 8);
    if (!palette.length) { toast('这张图没有可提取的颜色'); return; }
    current.matched = DQ.matchTraditional(palette);
    current.painting = name;

    // 海报用缩略图（长边 ≤ 680）
    var s2 = Math.min(1, 680 / Math.max(img.naturalWidth, img.naturalHeight));
    var thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(img.naturalWidth * s2));
    thumb.height = Math.max(1, Math.round(img.naturalHeight * s2));
    thumb.getContext('2d').drawImage(img, 0, 0, thumb.width, thumb.height);
    current.thumb = thumb;

    render(img.src, name);
  }

  function render(src, name) {
    els.preview.src = src;
    els.paintingName.textContent = name;
    els.paletteTitle.textContent = '画中拾得 · ' + current.matched.length + ' 色';
    els.palette.innerHTML = '';
    current.matched.forEach(function (m) {
      els.palette.appendChild(buildChip(m));
    });
    els.result.hidden = false;
  }

  function noteOf(name) {
    var notes = window.TRADITIONAL_COLOR_NOTES || {};
    return notes[name] || '';
  }

  function buildChip(m) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.title = '点击复制 ' + m.hex;
    var dark = DQ.luminance(m.rgb) > 168;
    var note = noteOf(m.name);
    chip.innerHTML =
      '<span class="chip-swatch' + (dark ? ' is-light' : '') + '" style="background:' + m.hex + '">' +
        '<i class="chip-source" style="background:' + m.sourceHex + '"></i>' +
        '<b class="chip-name">' + m.name + '</b>' +
      '</span>' +
      '<span class="chip-meta">' +
        '<code>' + m.hex + '</code>' +
        '<span class="chip-py">' + m.pinyin + '</span>' +
        (note ? '<span class="chip-note">' + note + '</span>' : '') +
        '<span class="chip-sub">占比 ' + (m.weight * 100).toFixed(1) + '% · 色差 ' + m.dist.toFixed(0) + '</span>' +
      '</span>';
    chip.addEventListener('click', function () {
      copyText(m.hex, '已复制 ' + m.name + ' ' + m.hex);
    });
    return chip;
  }

  /* ---------- 导出 ---------- */

  function cssText() {
    var lines = ['/* 丹青取色 · ' + current.painting + ' */', ':root {'];
    current.matched.forEach(function (m) {
      lines.push('  --' + m.name + ': ' + m.hex + '; /* ' + (m.weight * 100).toFixed(1) + '% */');
    });
    lines.push('}');
    return lines.join('\n');
  }

  function jsonText() {
    return JSON.stringify({
      painting: current.painting,
      colors: current.matched.map(function (m) {
        var item = {
          name: m.name, pinyin: m.pinyin, hex: m.hex, rgb: m.rgb,
          weight: +(m.weight * 100).toFixed(1),
          source: m.sourceHex
        };
        var note = noteOf(m.name);
        if (note) item.note = note;
        return item;
      })
    }, null, 2);
  }

  function copyText(text, okMsg) {
    function done() { toast(okMsg || '已复制'); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动复制'); }
      document.body.removeChild(ta);
    }
  }

  /* ---------- 色卡海报（多尺寸） ---------- */

  var SERIF = '"Songti SC","STSong","STZhongsong","SimSun","Noto Serif CJK SC",serif';

  // 各尺寸的版式参数：[宽, 高, 顶边距, 色带高, 原画小样最大高, 落款Y, 标题字号, 标题步距, 印章边长, 原画小样区宽]
  var POSTER_PLANS = {
    poster:    { w: 1080, h: 1620, top: 190, band: 760, thumb: 200, coloY: 1444, tSize: 76, tStep: 96, seal: 92,  thumbW: 854 },
    wallpaper: { w: 1080, h: 2340, top: 260, band: 1160, thumb: 300, coloY: 2160, tSize: 76, tStep: 96, seal: 92,  thumbW: 854 },
    square:    { w: 1080, h: 1080, top: 120, band: 430, thumb: 0, coloY: 940, tSize: 52, tStep: 68, seal: 68, thumbW: 0 }
  };

  function drawPoster(sizeKey) {
    var p = POSTER_PLANS[sizeKey] || POSTER_PLANS.poster;
    var W = p.w, H = p.h;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    var colors = current.matched;

    // 纸底
    x.fillStyle = '#f6f1e4';
    x.fillRect(0, 0, W, H);
    // 边框：双线
    x.strokeStyle = '#c9bda0';
    x.lineWidth = 2;
    x.strokeRect(34, 34, W - 68, H - 68);
    x.strokeRect(42, 42, W - 84, H - 84);

    var n = colors.length;
    var titleW = 128;
    var mx = 78;
    var gap = 18;
    var bandW = Math.floor((W - mx * 2 - titleW - gap * (n - 1)) / n);
    var bandY = p.top;
    var bandH = p.band;

    colors.forEach(function (m, i) {
      var bx = mx + i * (bandW + gap);
      // 色块
      x.fillStyle = m.hex;
      x.fillRect(bx, bandY, bandW, bandH);
      // 细描边
      x.strokeStyle = 'rgba(0,0,0,.08)';
      x.strokeRect(bx + .5, bandY + .5, bandW - 1, bandH - 1);
      // 原色小圆
      x.beginPath();
      x.arc(bx + bandW / 2, bandY + 56, 22, 0, Math.PI * 2);
      x.fillStyle = m.sourceHex;
      x.fill();
      x.lineWidth = 3;
      x.strokeStyle = 'rgba(255,255,255,.85)';
      x.stroke();

      // 竖排色名（色带较矮时放在色带下沿之上，较高时沉底）
      var dark = DQ.luminance(m.rgb) > 168;
      x.fillStyle = dark ? '#3a352c' : '#f7f2e6';
      var name = m.name;
      var fs = name.length > 4 ? 34 : 44;
      if (bandH < 520) fs = name.length > 4 ? 26 : 32;
      x.font = '600 ' + fs + 'px ' + SERIF;
      x.textAlign = 'center';
      x.textBaseline = 'top';
      var cy = bandY + bandH - 36 - name.length * fs * 1.18;
      for (var j = 0; j < name.length; j++) {
        x.fillText(name[j], bx + bandW / 2, cy + j * fs * 1.18);
      }

      // 块下信息
      x.fillStyle = '#3a352c';
      x.font = '26px "SFMono-Regular",Consolas,monospace';
      x.fillText(m.hex, bx + bandW / 2, bandY + bandH + 26);
      x.fillStyle = '#8a7f68';
      x.font = '24px ' + SERIF;
      x.fillText(m.pinyin, bx + bandW / 2, bandY + bandH + 66);
      x.fillText((m.weight * 100).toFixed(1) + '%', bx + bandW / 2, bandY + bandH + 102);
    });

    // 竖排主标题
    var title = '丹青取色';
    x.fillStyle = '#2f2b24';
    x.font = '700 ' + p.tSize + 'px ' + SERIF;
    var tx = W - mx - 30;
    var ty = bandY + 20;
    for (var t = 0; t < title.length; t++) {
      x.fillText(title[t], tx, ty + t * p.tStep);
    }

    // 印章
    var sealS = p.seal;
    var sx = tx - sealS / 2, sy = ty + title.length * p.tStep + 24;
    x.fillStyle = '#9e2f26';
    roundRect(x, sx, sy, sealS, sealS, 10);
    x.fill();
    x.fillStyle = '#f6f1e4';
    x.font = '600 ' + Math.round(sealS * 0.37) + 'px ' + SERIF;
    x.fillText('丹', tx, sy + sealS * 0.13);
    x.fillText('青', tx, sy + sealS * 0.55);

    // 原画小样（方图不画）
    var thumb = current.thumb;
    if (thumb && p.thumb > 0) {
      var tw = thumb.width, thh = thumb.height;
      var s3 = Math.min(p.thumbW / tw, p.thumb / thh);
      var dw = Math.round(tw * s3), dh = Math.round(thh * s3);
      var dx = mx + Math.round((p.thumbW - dw) / 2);
      var dy = bandY + bandH + 220;
      x.fillStyle = '#2e3b4e';
      x.fillRect(dx - 8, dy - 8, dw + 16, dh + 16);
      x.strokeStyle = '#c9a86a';
      x.lineWidth = 1.5;
      x.strokeRect(dx - 4.5, dy - 4.5, dw + 9, dh + 9);
      x.drawImage(thumb, dx, dy, dw, dh);
    }

    // 落款
    x.fillStyle = '#6d6553';
    x.font = '28px ' + SERIF;
    x.textAlign = 'left';
    x.fillText('画 · ' + current.painting, mx, p.coloY);
    x.fillText('色 · 匹配自 526 种中国传统色', mx, p.coloY + 48);
    x.textAlign = 'right';
    x.fillText(new Date().toLocaleDateString('zh-CN'), W - mx, p.coloY);
    x.font = '24px ' + SERIF;
    x.fillText('丹青取色 · 从古画中提取中国传统色', W - mx, p.coloY + 48);

    return c;
  }

  function roundRect(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }

  function downloadPoster() {
    var sizeKey = els.size.value || 'poster';
    var c = drawPoster(sizeKey);
    c.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '丹青取色 · ' + current.painting + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast('色卡海报已生成');
    }, 'image/png');
  }

  /* ---------- 交互绑定 ---------- */

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.classList.remove('show'); }, 1800);
  }

  function initSamples() {
    window.SAMPLE_PAINTINGS.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sample';
      b.innerHTML = '<img src="' + s.src + '" alt="' + s.label + '"><span>' + s.label + '</span>';
      b.addEventListener('click', function () {
        loadSrc(s.src, s.label);
        document.getElementById('result').scrollIntoView({ behavior: 'smooth' });
      });
      els.samples.appendChild(b);
    });
  }

  function init() {
    initSamples();

    els.dropzone.addEventListener('click', function () { els.file.click(); });
    els.file.addEventListener('change', function () {
      if (els.file.files[0]) loadFile(els.file.files[0]);
      els.file.value = '';
    });

    ['dragover', 'dragenter'].forEach(function (ev) {
      els.dropzone.addEventListener(ev, function (e) { e.preventDefault(); els.dropzone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      els.dropzone.addEventListener(ev, function (e) { e.preventDefault(); els.dropzone.classList.remove('over'); });
    });
    els.dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    document.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (/^image\//.test(items[i].type)) {
          loadFile(items[i].getAsFile());
          e.preventDefault();
          return;
        }
      }
    });

    els.btnCss.addEventListener('click', function () { copyText(cssText(), 'CSS 变量已复制'); });
    els.btnJson.addEventListener('click', function () { copyText(jsonText(), 'JSON 已复制'); });
    els.btnPoster.addEventListener('click', downloadPoster);
  }

  init();

  // 测试钩子：便于自动化验证海报输出
  window.__danqing = { poster: drawPoster, state: current };
})();
