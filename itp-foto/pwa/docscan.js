'use strict';

/* ============================================================
   DocScan — detectează o foaie/document în fotografie și o
   decupează + îndreaptă (ca la scanare). Toată procesarea OpenCV
   rulează într-un Web Worker (docscan-worker.js), iar OpenCV se
   încarcă din /vendor (fișier local, fără internet).

   Orice eroare → null / false: aplicația păstrează poza întreagă.
   ============================================================ */
const DocScan = (() => {
  const WORKER_URL      = '/docscan-worker.js';
  const LOAD_TIMEOUT_MS = 60000;
  const CALL_TIMEOUT_MS = 20000;

  // Analiza se face pe o copie micșorată — rapid și suficient de precis
  const DETECT_MAX_SIDE = 640;

  let worker = null;
  let ready = false;
  let loadPromise = null;
  let seq = 0;
  const pending = new Map(); // id → {resolve, reject, timer}

  /* ---- worker ---- */

  function failAll(reason) {
    pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error(reason)); });
    pending.clear();
  }

  function resetWorker(reason) {
    ready = false;
    loadPromise = null; // permite o nouă încercare mai târziu
    if (worker) { try { worker.terminate(); } catch {} }
    worker = null;
    failAll(reason);
  }

  function load() {
    if (ready) return Promise.resolve(true);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise(resolve => {
      let settled = false;
      const done = ok => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) resetWorker('OpenCV nu s-a putut încărca');
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS);

      try {
        worker = new Worker(WORKER_URL);
      } catch (err) {
        done(false);
        return;
      }

      worker.onmessage = e => {
        const msg = e.data || {};
        if (msg.type === 'ready') {
          if (msg.ok) ready = true;
          else console.warn('[docscan] OpenCV indisponibil:', msg.error);
          done(!!msg.ok);
          return;
        }
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error || 'Eroare la procesare'));
      };

      // Worker-ul a căzut (ex. memorie insuficientă) — îl repornim la nevoie
      worker.onerror = e => {
        e.preventDefault && e.preventDefault();
        console.warn('[docscan] worker oprit:', e.message);
        if (!settled) done(false);
        else resetWorker('Procesarea a fost întreruptă');
      };

      worker.postMessage({ type: 'init' });
    });

    return loadPromise;
  }

  function isReady() {
    return ready;
  }

  /* Așteaptă OpenCV cel mult `ms` milisecunde — nu blocăm inspectorul */
  async function waitReady(ms) {
    if (ready) return true;
    const p = load();
    let t;
    const timeout = new Promise(resolve => { t = setTimeout(() => resolve(false), ms); });
    const ok = await Promise.race([p, timeout]);
    clearTimeout(t);
    return ok === true;
  }

  function call(type, payload, transfer) {
    if (!worker || !ready) return Promise.reject(new Error('OpenCV nu este încărcat'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Procesarea durează prea mult'));
        // Worker blocat — îl oprim; se repornește automat la următoarea poză
        resetWorker('Procesarea a fost oprită');
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage(Object.assign({ id, type }, payload), transfer || []);
    });
  }

  function imageDataOf(canvas, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  /* ---- API ---- */

  /* Returnează cele 4 colțuri ale documentului (coordonate în `canvas`) sau null */
  async function detect(canvas, dbg) {
    if (!ready || !canvas || !canvas.width || !canvas.height) return null;
    try {
      const W = canvas.width, H = canvas.height;
      const s = Math.min(1, DETECT_MAX_SIDE / Math.max(W, H));
      const img = imageDataOf(canvas, Math.round(W * s), Math.round(H * s));
      const res = await call('detect', { image: img, debug: !!dbg }, [img.data.buffer]);
      if (dbg && res && res.dbg) Object.assign(dbg, res.dbg);
      if (!res || !res.quad) return null;
      return res.quad.map(p => ({ x: p.x / s, y: p.y / s }));
    } catch (err) {
      console.warn('[docscan] detecție eșuată:', err);
      return null;
    }
  }

  /* Decupează și îndreaptă documentul. Returnează un canvas nou sau null. */
  async function warp(canvas, quad) {
    if (!ready || !canvas || !DocScanCore.isConvexQuad(quad)) return null;
    try {
      const img = imageDataOf(canvas, canvas.width, canvas.height);
      const res = await call('warp', { image: img, quad }, [img.data.buffer]);
      if (!res) return null;
      const out = document.createElement('canvas');
      out.width = res.width;
      out.height = res.height;
      out.getContext('2d').putImageData(new ImageData(res.data, res.width, res.height), 0, 0);
      return out;
    } catch (err) {
      console.warn('[docscan] decupare eșuată:', err);
      return null;
    }
  }

  return {
    load, isReady, waitReady, detect, warp,
    isConvexQuad: DocScanCore.isConvexQuad,
    orderCorners: DocScanCore.orderCorners,
    polygonArea:  DocScanCore.polygonArea,
  };
})();
