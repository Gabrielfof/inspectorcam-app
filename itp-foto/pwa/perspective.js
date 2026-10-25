'use strict';

/* ============================================================
   Perspective — decupează și îndreaptă documentul după cele 4
   colțuri alese de inspector (ca la scanare). Fără biblioteci.
   ============================================================ */
const Perspective = (() => {
  // Dimensiunea maximă a documentului îndreptat (aceeași ca pozele normale)
  const OUT_LONG  = 1600;
  const OUT_SHORT = 1200;

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /* Ordonează colțurile: stânga-sus, dreapta-sus, dreapta-jos, stânga-jos */
  function orderCorners(pts) {
    if (!pts || pts.length !== 4) return null;
    // Sortare după unghi în jurul centrului — sens orar pe ecran (y în jos)
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    const sorted = [...pts].sort((a, b) =>
      Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let start = 0;
    for (let i = 1; i < 4; i++) {
      if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
    }
    return [0, 1, 2, 3].map(i => sorted[(start + i) % 4]);
  }

  function polygonArea(q) {
    let a = 0;
    for (let i = 0; i < q.length; i++) {
      const p = q[i], n = q[(i + 1) % q.length];
      a += p.x * n.y - n.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  /* Patrulater convex, fără auto-intersecții (colțuri în ordine tl,tr,br,bl) */
  function isConvexQuad(q) {
    if (!q || q.length !== 4) return false;
    if (q.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-6) return false;
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  /* Dimensiunea documentului îndreptat, limitată la 1600×1200 */
  function outputSize(q) {
    const [tl, tr, br, bl] = q;
    const w = Math.max(dist(tl, tr), dist(bl, br));
    const h = Math.max(dist(tl, bl), dist(tr, br));
    const scale = Math.min(1, OUT_LONG / Math.max(w, h), OUT_SHORT / Math.min(w, h));
    return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
  }

  /* Omografia care duce dreptunghiul (0,0)-(w,h) în patrulaterul q */
  function homography(w, h, q) {
    const [p0, p1, p2, p3] = q;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / den;
    const k = (dx1 * dy3 - dx3 * dy1) / den;
    // Pătratul unitate → q, apoi scalăm din (w, h) în pătratul unitate
    const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + k * p3.x, c = p0.x;
    const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + k * p3.y, f = p0.y;
    return { a: a / w, b: b / h, c, d: d / w, e: e / h, f, g: g / w, k: k / h };
  }

  /* Decupează și îndreaptă. Returnează un canvas nou sau null. */
  function warp(canvas, quad) {
    if (!canvas || !isConvexQuad(quad)) return null;
    const [w, h] = outputSize(quad);
    const sw = canvas.width, sh = canvas.height;
    const src = canvas.getContext('2d').getImageData(0, 0, sw, sh).data;

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const img = octx.createImageData(w, h);
    const dst = img.data;
    const H = homography(w, h, quad);

    for (let y = 0; y < h; y++) {
      const v = y + 0.5;
      for (let x = 0; x < w; x++) {
        const u = x + 0.5;
        const z = H.g * u + H.k * v + 1;
        let sx = (H.a * u + H.b * v + H.c) / z - 0.5;
        let sy = (H.d * u + H.e * v + H.f) / z - 0.5;
        // Interpolare biliniară, cu marginile imaginii prelungite
        if (sx < 0) sx = 0; else if (sx > sw - 1) sx = sw - 1;
        if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;
        const x0 = sx | 0, y0 = sy | 0;
        const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
        const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        const o = (y * w + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = src[i00 + ch] + (src[i10 + ch] - src[i00 + ch]) * fx;
          const bot = src[i01 + ch] + (src[i11 + ch] - src[i01 + ch]) * fx;
          dst[o + ch] = top + (bot - top) * fy;
        }
        dst[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  return { warp, orderCorners, isConvexQuad, polygonArea };
})();
