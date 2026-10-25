'use strict';

/* ============================================================
   DocScanCore — algoritmul de detectare și îndreptare a unei foi.
   Fără DOM: rulează în Web Worker (docscan-worker.js, cu OpenCV)
   și pe pagina principală (doar funcțiile de geometrie).
   ============================================================ */
const DocScanCore = (() => {
  // Dimensiunea maximă a documentului îndreptat (aceeași ca pozele normale)
  const OUT_LONG  = 1600;
  const OUT_SHORT = 1200;

  /* ---- geometrie ---- */

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /* Ordonează colțurile: stânga-sus, dreapta-sus, dreapta-jos, stânga-jos */
  function orderCorners(pts) {
    if (!pts || pts.length !== 4) return null;
    // Sortare după unghi în jurul centrului — sens orar pe ecran (y în jos),
    // funcționează și pentru foi rotite la 45°
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

  function cornerAngles(q) {
    return q.map((p, i) => {
      const a = q[(i + 3) % 4], c = q[(i + 1) % 4];
      const v1x = a.x - p.x, v1y = a.y - p.y;
      const v2x = c.x - p.x, v2y = c.y - p.y;
      const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
      return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    });
  }

  /* Dimensiunea documentului îndreptat, limitată la 1600×1200 */
  function outputSize(q) {
    const [tl, tr, br, bl] = q;
    const w = Math.max(dist(tl, tr), dist(bl, br));
    const h = Math.max(dist(tl, bl), dist(tr, br));
    const scale = Math.min(1, OUT_LONG / Math.max(w, h), OUT_SHORT / Math.min(w, h));
    return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
  }

  /* Strânge colțurile spre centru — conturul găsit stă pe marginea foii și
     ar lăsa o fâșie subțire din masă în decupaj */
  function insetQuad(q, f) {
    const cx = q.reduce((s, p) => s + p.x, 0) / 4;
    const cy = q.reduce((s, p) => s + p.y, 0) / 4;
    return q.map(p => ({ x: cx + (p.x - cx) * (1 - f), y: cy + (p.y - cy) * (1 - f) }));
  }

  /* Rafinează colțurile: fiecare latură e recalculată din marginea reală găsită
     în imagine pe porțiunea ei din mijloc, iar colțurile ies din intersecția
     laturilor. Corectează colțuri tăiate (colț îndoit, scris de mână) sau trase
     de un obiect alb lipit de foaie. Marginea = foaia mai luminoasă sau mai puțin
     colorată decât fundalul. */
  function refineQuad(gray, sat, q, radius) {
    const W = gray.cols, H = gray.rows, d = gray.data, sd = sat.data;
    const at = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      return (xi < 0 || yi < 0 || xi >= W || yi >= H) ? -1 : yi * W + xi;
    };
    const cx = q.reduce((s, p) => s + p.x, 0) / 4;
    const cy = q.reduce((s, p) => s + p.y, 0) / 4;
    const R = Math.max(4, Math.round(Math.min(W, H) * radius));
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const len = dist(a, b);
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      let nx = -uy, ny = ux;
      if ((cx - (a.x + b.x) / 2) * nx + (cy - (a.y + b.y) / 2) * ny < 0) { nx = -nx; ny = -ny; }
      let pts = [];
      for (let k = 0; k <= 24; k++) {
        const t = 0.12 + 0.76 * k / 24;
        const bx = a.x + (b.x - a.x) * t, by = a.y + (b.y - a.y) * t;
        let best = 0, bestO = 0;
        for (let o = -R; o <= R; o++) {
          const iIn = at(bx + nx * (o + 2), by + ny * (o + 2));
          const iOut = at(bx + nx * (o - 2), by + ny * (o - 2));
          if (iIn < 0 || iOut < 0) continue;
          // Preferăm marginea cea mai apropiată de latura inițială la scor egal
          const score = Math.max(d[iIn] - d[iOut], sd[iOut] - sd[iIn]) - Math.abs(o) * 0.15;
          if (score > best) { best = score; bestO = o; }
        }
        if (best >= 15) pts.push({ x: bx + nx * bestO, y: by + ny * bestO });
      }
      if (pts.length < 10) return null;
      // Dreapta prin puncte (cele mai mici pătrate totale), refăcută fără
      // punctele cele mai depărtate (scris, umbre, colțuri îndoite)
      let line = null;
      for (let pass = 0; pass < 2; pass++) {
        const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        let sxx = 0, syy = 0, sxy = 0;
        pts.forEach(p => { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        line = { x: mx, y: my, dx: Math.cos(ang), dy: Math.sin(ang) };
        if (pass === 0) {
          const res = pts.map(p => Math.abs((p.x - mx) * line.dy - (p.y - my) * line.dx));
          const cut = [...res].sort((x, y) => x - y)[Math.floor(res.length * 0.75)];
          pts = pts.filter((p, k) => res[k] <= cut);
          if (pts.length < 8) return null;
        }
      }
      lines.push(line);
    }
    const out = [];
    for (let i = 0; i < 4; i++) {
      const L1 = lines[(i + 3) % 4], L2 = lines[i];   // colțul i = latura i-1 ∩ latura i
      const den = L1.dx * L2.dy - L1.dy * L2.dx;
      if (Math.abs(den) < 1e-6) return null;
      const t = ((L2.x - L1.x) * L2.dy - (L2.y - L1.y) * L2.dx) / den;
      out.push({ x: L1.x + L1.dx * t, y: L1.y + L1.dy * t });
    }
    // Acceptăm doar corecturi rezonabile și o formă validă
    const maxMove = Math.hypot(W, H) * radius * 1.4;
    if (!isConvexQuad(out) || out.some((p, i) => dist(p, q[i]) > maxMove)) return null;
    return out;
  }

  /* ---- detecție (necesită OpenCV) ---- */

  /* Extrage patrulaterele candidate dintr-o imagine binară (contururi) */
  function collectQuads(cv, binary, minArea, out) {
    const contours  = new cv.MatVector();
    const hierarchy = new cv.Mat();
    try {
      cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const hull = new cv.Mat();
        const approx = new cv.Mat();
        try {
          const cArea = cv.contourArea(c);
          if (cArea < minArea) continue;
          // Învelitoarea convexă ignoră degetele / colțurile îndoite
          cv.convexHull(c, hull, false, true);
          const peri = cv.arcLength(hull, true);
          for (const eps of [0.02, 0.035, 0.05]) {
            cv.approxPolyDP(hull, approx, eps * peri, true);
            if (approx.rows === 4) break;
          }
          if (approx.rows !== 4) continue;
          const pts = [];
          for (let k = 0; k < 4; k++) {
            pts.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] });
          }
          const q = orderCorners(pts);
          // Conturul real trebuie să umple patrulaterul — altfel e o grămadă de
          // obiecte „încercuite” de învelitoarea convexă, nu o foaie
          if (q && isConvexQuad(q) && cArea >= polygonArea(q) * 0.85) out.push(q);
        } finally {
          c.delete(); hull.delete(); approx.delete();
        }
      }
    } finally {
      contours.delete();
      hierarchy.delete();
    }
  }

  /* Proporții și poziție plauzibile pentru o foaie fotografiată */
  function isPlausibleDocument(q, imgW, imgH) {
    const ratio = polygonArea(q) / (imgW * imgH);
    // Prea mic → probabil alt obiect; aproape tot cadrul → nu are rost decupajul
    if (ratio < 0.15 || ratio > 0.97) return false;

    // Colțuri apropiate de 90° (permitem perspectivă)
    if (cornerAngles(q).some(a => a < 50 || a > 130)) return false;

    // Proporții de document (A4 ≈ 1.41, talon ≈ 1.4) — exclude plăcuțele (~4.7)
    const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
    const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
    if (aspect > 2.2) return false;

    // Toate colțurile lipite de marginea pozei → e chiar cadrul, nu o foaie
    const m = Math.min(imgW, imgH) * 0.02;
    const onEdge = q.filter(p => p.x < m || p.y < m || p.x > imgW - m || p.y > imgH - m).length;
    if (onEdge === 4) return false;

    return true;
  }

  /* Cât de „margine reală” e fiecare latură (0..1): pe ce parte din lungime
     interiorul (foaia) se deosebește clar de exterior — mai luminos, de altă
     culoare fără să fie mai întunecat (talon colorat), sau vizibil mai puțin
     colorat (hârtia e neutră; lemnul, mocheta, vopseaua nu — chiar dacă foaia
     e în umbră și mai întunecată decât un parchet deschis). */
  function edgesSupported(gray, rgba, sat, q) {
    const W = gray.cols, H = gray.rows, d = gray.data, c = rgba.data, sd = sat.data;
    const cx = q.reduce((s, p) => s + p.x, 0) / 4;
    const cy = q.reduce((s, p) => s + p.y, 0) / 4;
    const OFF = Math.max(3, Math.round(Math.min(W, H) * 0.008));
    const idx = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      return (xi < 0 || yi < 0 || xi >= W || yi >= H) ? -1 : yi * W + xi;
    };
    const ratios = [];
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const len = dist(a, b);
      let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny; } // normala spre interior
      const N = 40;
      let pos = 0, counted = 0;
      for (let k = 2; k < N - 2; k++) {          // fără capete (colțuri, umbre)
        const t = k / (N - 1);
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const iIn = idx(x + nx * OFF, y + ny * OFF);
        const iOut = idx(x - nx * OFF, y - ny * OFF);
        if (iIn < 0 || iOut < 0) continue;        // în afara pozei
        counted++;
        const dL = d[iIn] - d[iOut];
        const dC = Math.max(Math.abs(c[iIn * 4] - c[iOut * 4]),
                            Math.abs(c[iIn * 4 + 1] - c[iOut * 4 + 1]),
                            Math.abs(c[iIn * 4 + 2] - c[iOut * 4 + 2]));
        const dS = sd[iOut] - sd[iIn];
        if (dL >= 12 || (dC >= 24 && dL >= -4) || (dS >= 20 && dC >= 20)) pos++;
      }
      // O latură aproape în întregime în afara pozei nu poate fi verificată
      ratios.push(counted < (N - 4) * 0.5 ? 0 : pos / counted);
    }
    return ratios.sort((x, y) => y - x);   // descrescător
  }

  // Toate laturile clare
  function edgesStrong(r) {
    return r[3] >= 0.7 && (r[0] + r[1] + r[2] + r[3]) / 4 >= 0.8;
  }

  /* Interiorul arată a hârtie: necolorat, cu text/linii.
     Exclude caroseria, geamurile, ecranele etc. */
  function looksLikePaper(cv, srcRgba, q, allowBlank) {
    const r = dist(q[0], q[1]) / Math.max(1, dist(q[0], q[3]));
    const [w, h] = r >= 1 ? [320, Math.round(320 / r)] : [Math.round(320 * r), 320];
    if (w < 20 || h < 20) return false;

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap(p => [p.x, p.y]));
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const M   = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    try {
      cv.warpPerspective(srcRgba, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      const d = dst.data;
      const n = w * h;
      const lum = new Uint8Array(n);
      let sumL = 0, sumS = 0;
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const rr = d[p], g = d[p + 1], b = d[p + 2];
        const l = (rr * 299 + g * 587 + b * 114) / 1000;
        lum[i] = l;
        sumL += l;
        sumS += Math.max(rr, g, b) - Math.min(rr, g, b);
      }
      const meanL = sumL / n;
      const meanS = sumS / n;
      const darkT = meanL * 0.75;
      let dark = 0;
      for (let i = 0; i < n; i++) if (lum[i] < darkT) dark++;
      const darkFrac = dark / n;

      // Luminozitatea e relativă (marginile garantează deja foaie > fundal):
      // acceptăm și lumină slabă; textul/liniile trebuie să existe
      return meanL >= 50 && meanS <= 60 && darkFrac <= 0.45 && (allowBlank || darkFrac >= 0.002);
    } finally {
      srcTri.delete(); dstTri.delete(); M.delete(); dst.delete();
    }
  }

  /* Caută foaia într-o imagine RGBA ({width, height, data}).
     Returnează 4 colțuri în coordonatele imaginii sau null. */
  function detect(cv, img, dbg) {
    const sw = img.width, sh = img.height;
    if (!sw || !sh) return null;

    const mats = [];
    const track = m => { mats.push(m); return m; };
    try {
      const src   = track(new cv.Mat(sh, sw, cv.CV_8UC4));
      src.data.set(img.data);
      const gray  = track(new cv.Mat());
      const blur  = track(new cv.Mat());
      const edges = track(new cv.Mat());
      const cblur = track(new cv.Mat());
      const bin   = track(new cv.Mat());
      const k3    = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
      const k5    = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
      const k7    = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7)));
      const rgb   = track(new cv.Mat());
      const hsv   = track(new cv.Mat());
      const chans = track(new cv.MatVector());
      const lowS  = track(new cv.Mat());
      const highV = track(new cv.Mat());
      const hsvB  = track(new cv.Mat());
      const chB   = track(new cv.MatVector());

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.GaussianBlur(src, cblur, new cv.Size(5, 5), 0);

      const minArea = sw * sh * 0.15;
      const candidates = [];

      // 1) Margini (Canny) — merge bine pe fundal cu contrast
      cv.Canny(blur, edges, 40, 130);
      cv.dilate(edges, edges, k3);
      collectQuads(cv, edges, minArea, candidates);

      // 2) Margini fine, îngroșate — închid conturul când fundalul seamănă cu foaia
      cv.Canny(blur, edges, 20, 60);
      cv.dilate(edges, edges, k5);
      collectQuads(cv, edges, minArea, candidates);

      // 3) Prag automat (Otsu) — foaia albă pe fundal mai închis
      cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k7);
      collectQuads(cv, bin, minArea, candidates);

      // 4) Mască „alb necolorat” — separă foaia de vopseaua mașinii, bord, scaune
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      cv.split(hsv, chans);
      const satCh = track(chans.get(1));   // get() creează un Mat nou — trebuie eliberat
      const valCh = track(chans.get(2));
      cv.threshold(satCh, lowS, 60, 255, cv.THRESH_BINARY_INV);
      cv.threshold(valCh, highV, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.bitwise_and(lowS, highV, bin);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k7);
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k5);
      collectQuads(cv, bin, minArea, candidates);

      // 5) Neutru vs colorat (prag automat pe saturație) — foaia gri/albă pe lemn
      //    deschis, mochetă, vopsea, chiar dacă e în umbră
      cv.cvtColor(cblur, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsvB, cv.COLOR_RGB2HSV);
      cv.split(hsvB, chB);
      const satB = track(chB.get(1));
      cv.threshold(satB, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k7);
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k5);
      collectQuads(cv, bin, minArea, candidates);

      // Cel mai mare candidat valid, cu toate marginile clare, câștigă
      candidates.sort((a, b) => polygonArea(b) - polygonArea(a));
      if (dbg) dbg.candidates = candidates.length;
      const checked = [];
      for (const q0 of candidates) {
        if (!isPlausibleDocument(q0, sw, sh)) { if (dbg) dbg.shape = (dbg.shape || 0) + 1; continue; }
        // Rafinăm înainte de verificare — un colț tăiat nu mai respinge o foaie corectă.
        // Păstrăm rafinarea doar dacă toate marginile ei sunt clare (altfel a
        // „sărit” pe o margine greșită, ex. o umbră)
        // Întâi o căutare apropiată (precisă); cea largă corectează doar un colț
        // tăiat de contur — numai când conturul are deja 3 laturi bune
        const e0 = edgesSupported(blur, cblur, satB, q0);
        let found = null;
        for (const radius of e0[2] >= 0.6 ? [0.02, 0.06] : [0.02]) {
          const r = refineQuad(blur, satB, q0, radius);
          const er = r && isPlausibleDocument(r, sw, sh) ? edgesSupported(blur, cblur, satB, r) : null;
          if (er && edgesStrong(er)) { found = { q: r, refined: true, er }; break; }
        }
        checked.push(found || { q: q0, refined: false, er: e0 });
      }
      const pick = test => {
        for (const c of checked) {
          if (!test(c.er)) continue;
          // Foaie fără text (verso, foaie în folie) — doar cu toate 4 marginile perfecte
          if (looksLikePaper(cv, src, c.q, c.er[3] >= 0.9)) return c;
          if (dbg) dbg.paper = (dbg.paper || 0) + 1;
        }
        return null;
      };
      if (dbg) dbg.list = checked.map(c => ({ q: c.q.map(p => [p.x, p.y]), er: c.er.map(v => +v.toFixed(2)), refined: c.refined }));
      const best = pick(edgesStrong);
      if (dbg && !best) dbg.edges = checked.length;
      if (!best) return null;
      if (dbg) dbg.refined = best.refined;
      // Colțurile rafinate stau exact pe margine — le strângem doar puțin
      return insetQuad(best.q, best.refined ? 0.004 : 0.01);
    } finally {
      mats.forEach(m => { try { m.delete(); } catch {} });
    }
  }

  /* Decupează și îndreaptă documentul. Returnează {width, height, data} sau null. */
  function warp(cv, img, quad) {
    if (!isConvexQuad(quad)) return null;
    const [w, h] = outputSize(quad);

    const mats = [];
    const track = m => { mats.push(m); return m; };
    try {
      const src    = track(new cv.Mat(img.height, img.width, cv.CV_8UC4));
      src.data.set(img.data);
      const dst    = track(new cv.Mat());
      const srcTri = track(cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap(p => [p.x, p.y])));
      const dstTri = track(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]));
      const M      = track(cv.getPerspectiveTransform(srcTri, dstTri));
      cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      // Copiem din memoria OpenCV înainte de eliberarea Mat-ului
      return { width: w, height: h, data: new Uint8ClampedArray(dst.data) };
    } finally {
      mats.forEach(m => { try { m.delete(); } catch {} });
    }
  }

  return { orderCorners, polygonArea, isConvexQuad, outputSize, detect, warp };
})();
