'use strict';

/* ============================================================
   Web Worker pentru decupare documente — OpenCV rulează aici,
   în fundal, ca interfața să rămână fluidă pe telefon.

   Mesaje primite:  {id, type: 'detect' | 'warp', image, quad?}
   Mesaje trimise:  {type: 'ready', ok}  |  {id, ok, result | error}
   ============================================================ */

let cv = null;

function warmUp() {
  // Prima rulare OpenCV e lentă (compilarea WebAssembly) — o facem acum,
  // în fundal, nu la prima poză a inspectorului
  const w = 320, h = 240;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = x > 80 && x < 240 && y > 30 && y < 210;
      const v = inside ? ((y % 12 === 0 && x > 100 && x < 220) ? 40 : 240) : 90;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const img = { width: w, height: h, data };
  const q = DocScanCore.detect(cv, img);
  if (q) DocScanCore.warp(cv, img, q);
}

function init() {
  try {
    importScripts('/docscan-core.js', '/vendor/opencv-4.9.0.js');
  } catch (err) {
    self.postMessage({ type: 'ready', ok: false, error: String(err) });
    return;
  }
  const mod = self.cv;
  const ready = () => {
    if (typeof mod.Mat !== 'function') {
      self.postMessage({ type: 'ready', ok: false, error: 'OpenCV incomplet' });
      return;
    }
    cv = mod;
    try { warmUp(); } catch { /* încălzirea e opțională */ }
    self.postMessage({ type: 'ready', ok: true });
  };
  // Modulul OpenCV are o metodă then() proprie — nu îl dăm niciodată
  // direct unui Promise (ar intra într-o buclă infinită)
  if (mod && typeof mod.Mat === 'function') ready();
  else if (mod && typeof mod.then === 'function') mod.then(() => ready());
  else self.postMessage({ type: 'ready', ok: false, error: 'OpenCV lipsă' });
}

self.onmessage = e => {
  const msg = e.data || {};
  if (msg.type === 'init') { init(); return; }
  if (!cv) {
    self.postMessage({ id: msg.id, ok: false, error: 'OpenCV nu este încărcat' });
    return;
  }
  try {
    if (msg.type === 'detect') {
      const dbg = msg.debug ? {} : null;
      const quad = DocScanCore.detect(cv, msg.image, dbg);
      if (dbg && cv.HEAPU8) dbg.heap = cv.HEAPU8.length;
      self.postMessage({ id: msg.id, ok: true, result: { quad, dbg } });
    } else if (msg.type === 'warp') {
      const out = DocScanCore.warp(cv, msg.image, msg.quad);
      if (out) self.postMessage({ id: msg.id, ok: true, result: out }, [out.data.buffer]);
      else self.postMessage({ id: msg.id, ok: true, result: null });
    } else {
      self.postMessage({ id: msg.id, ok: false, error: 'Mesaj necunoscut' });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
  }
};
