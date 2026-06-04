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

  // Dimensiune maximă: 1920×1080. Fotografiile mai mari se redimensionează.
  // Aceasta reduce dramatic timpul de procesare pe telefoane cu cameră 4K.
  const MAX_W = 1920;
  const MAX_H = 1080;

  function scaleDimensions(w, h) {
    const scale = Math.min(1, MAX_W / w, MAX_H / h);
    return [Math.round(w * scale), Math.round(h * scale)];
  }

  async function capture(watermarkData) {
    if (!videoEl || !isActive()) {
      throw new Error('Camera nu este activă.');
    }

    const vw = videoEl.videoWidth  || 1280;
    const vh = videoEl.videoHeight || 960;
    const [width, height] = scaleDimensions(Math.max(vw, 1280), Math.max(vh, 960));

    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(videoEl, 0, 0, width, height);
    applyWatermark(ctx, width, height, watermarkData);

    return canvasToBlob(canvas);
  }

  async function processImportedFile(file, watermarkData) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const [width, height] = scaleDimensions(
          Math.max(img.naturalWidth,  1280),
          Math.max(img.naturalHeight, 960)
        );

        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        applyWatermark(ctx, width, height, watermarkData);
        URL.revokeObjectURL(url);

        canvasToBlob(canvas).then(resolve).catch(reject);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Nu s-a putut procesa imaginea selectată.'));
      };

      img.src = url;
    });
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

  return { start, stop, isActive, capture, processImportedFile, applyNote };
})();
