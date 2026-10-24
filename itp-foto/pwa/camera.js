'use strict';

const Camera = (() => {
  let stream = null;
  let videoEl = null;

  async function start(videoElement) {
    videoEl = videoElement;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 960 },
        },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Permisiunea pentru cameră a fost refuzată. Verificați setările browserului.');
      } else if (err.name === 'NotFoundError') {
        throw new Error('Nu s-a găsit nicio cameră. Folosiți butonul "Galerie" pentru a importa fotografii.');
      }
      throw new Error('Nu s-a putut accesa camera: ' + err.message);
    }
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl = null;
    }
  }

  function isActive() {
    return stream !== null && stream.active;
  }

  const MAX_LONG  = 1600;
  const MAX_SHORT = 1200;

  // Latura lungă max 1600, cea scurtă max 1200 — portret și landscape au aceeași calitate
  function scaleDimensions(w, h) {
    const scale = Math.min(1, MAX_LONG / Math.max(w, h), MAX_SHORT / Math.min(w, h));
    return [Math.round(w * scale), Math.round(h * scale)];
  }

  /* Cadrul curent din stream, scalat, fără watermark */
  function captureCanvas() {
    if (!videoEl || !isActive()) {
      throw new Error('Camera nu este activă.');
    }

    const vw = videoEl.videoWidth  || 640;
    const vh = videoEl.videoHeight || 480;
    const [width, height] = scaleDimensions(vw, vh);

    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(videoEl, 0, 0, width, height);
    return canvas;
  }

  /* Fișier/blob → canvas scalat, cu orientarea EXIF aplicată, fără watermark */
  async function fileToCanvas(file) {
    try {
      // createImageBitmap cu imageOrientation: 'from-image' aplică automat rotația EXIF
      // — fix pentru fotografii landscape de pe iOS/Android
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(() => createImageBitmap(file)); // fallback pentru browsere mai vechi

      const [width, height] = scaleDimensions(bitmap.width, bitmap.height);

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return canvas;
    } catch {
      throw new Error('Nu s-a putut procesa imaginea selectată.');
    }
  }

  /* Aplică watermark-ul pe o copie a canvas-ului și returnează JPEG-ul final */
  function finalize(canvas, watermarkData) {
    const out = document.createElement('canvas');
    out.width  = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    applyWatermark(ctx, out.width, out.height, watermarkData);
    return canvasToBlob(out);
  }

  function applyWatermark(ctx, width, height, {
    datetime,
    isImport = false,
  }) {
    const fontSize = Math.max(Math.round(height * 0.028), 20);
    const padding  = Math.round(fontSize * 0.75);

    ctx.save();
    ctx.font        = `bold ${fontSize}px "JetBrains Mono", monospace`;
    ctx.lineJoin    = 'round';
    ctx.lineWidth   = Math.max(fontSize * 0.2, 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.88)';
    ctx.fillStyle   = '#FFFFFF';

    const text = datetime;

    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.strokeText(text, width - padding, height - padding);
    ctx.fillText(text,   width - padding, height - padding);

    ctx.restore();
  }

  function applyNoteOverlay(ctx, width, height, noteText) {
    if (!noteText) return;

    const fontSize = Math.max(Math.round(height * 0.028), 20);
    const padding  = Math.round(fontSize * 0.75);
    const noteFontSize = Math.max(Math.round(height * 0.03), 22);

    ctx.save();
    ctx.font        = `bold ${noteFontSize}px "JetBrains Mono", monospace`;
    ctx.lineJoin    = 'round';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';

    const noteY    = padding * 3;
    const measured = ctx.measureText(noteText);
    const boxW     = measured.width + noteFontSize * 2;
    const boxH     = noteFontSize * 1.8;
    const boxX     = (width - boxW) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(boxX, noteY, boxW, boxH, noteFontSize * 0.3);
    } else {
      ctx.rect(boxX, noteY, boxW, boxH);
    }
    ctx.fill();

    ctx.fillStyle   = '#FFFFFF';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth   = Math.max(noteFontSize * 0.12, 2);
    ctx.strokeText(noteText, width / 2, noteY + (boxH - noteFontSize) / 2);
    ctx.fillText(noteText,   width / 2, noteY + (boxH - noteFontSize) / 2);

    ctx.restore();
  }

  async function applyNote(baseBlob, noteText) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(baseBlob);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        applyNoteOverlay(ctx, canvas.width, canvas.height, noteText);
        canvasToBlob(canvas).then(resolve).catch(reject);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Eroare la procesarea imaginii pentru notiță.'));
      };

      img.src = url;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Eroare la convertirea imaginii.')),
        'image/jpeg',
        0.80
      );
    });
  }

  return {
    start, stop, isActive, applyNote,
    captureCanvas, fileToCanvas, finalize, canvasToBlob,
  };
})();
