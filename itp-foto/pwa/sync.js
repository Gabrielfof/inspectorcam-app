'use strict';

const Sync = (() => {
  const BASE = window.location.origin;

  async function api(path, options = {}) {
    const res  = await fetch(BASE + path, options);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.eroare || `Eroare HTTP ${res.status}`);
    return json;
  }

  async function fetchInspectors() {
    const data = await api('/api/inspectors');
    return data.inspectors || [];
  }

  async function fetchConfig() {
    const data = await api('/api/config');
    return data.config || {};
  }

  async function fetchTodayInspections() {
    const today = new Date().toISOString().slice(0, 10);
    const data  = await api(`/api/inspections?date=${today}`);
    return data.inspections || [];
  }

  async function verifyPin(inspector_id, pin) {
    return api('/api/inspectors/verify-pin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ inspector_id, pin }),
    });
  }

  // Verifică dacă un blob e cu adevărat lizibil (nu doar instanceof Blob)
  // Pe iOS, blob-urile "zombie" raportează size > 0 dar nu pot fi citite
  function isBlobReadable(blob) {
    if (!(blob instanceof Blob) || blob.size === 0) return Promise.resolve(false);
    return new Promise(resolve => {
      const r = new FileReader();
      r.onload  = () => resolve(true);
      r.onerror = () => resolve(false);
      r.readAsArrayBuffer(blob.slice(0, 64)); // citim primii 64 bytes
    });
  }

  // Reconstituie blob-urile moarte din dataUrl înainte de upload
  async function ensureBlobs(photos) {
    for (const p of photos) {
      const alive = await isBlobReadable(p.blob);
      if (!alive) {
        if (p.dataUrl) {
          try {
            p.blob = await fetch(p.dataUrl).then(r => r.blob());
          } catch {
            p.blob = null; // nu poate fi recuperat
          }
        } else {
          p.blob = null; // no dataUrl → marchează ca invalid
        }
      }
    }
  }

  // Construiește FormData cu meta și fișiere aliniate pe același index
  function buildPhotoFormData(fd, photos) {
    const valid = photos.filter(p => p.blob instanceof Blob && p.blob.size > 0);
    fd.append('photos_meta', JSON.stringify(valid.map(p => ({
      step:      p.step,
      note:      p.note      || '',
      source:    p.source    || 'camera',
      ocr_plate: p.ocr_plate || null,
      timestamp: p.timestamp,
    }))));
    valid.forEach(p => fd.append('files', p.blob, `${p.step}.jpg`));
  }

  async function uploadInspection(inspection) {
    await ensureBlobs(inspection.photos);
    const fd = new FormData();
    fd.append('plate',        inspection.plate);
    fd.append('inspector_id', inspection.inspector_id);
    fd.append('datetime',     inspection.datetime);
    fd.append('notes',        inspection.notes || '');
    fd.append('device_id',    inspection.device_id || '');
    fd.append('app_version',  '1.0.0');
    buildPhotoFormData(fd, inspection.photos);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      return await api('/api/inspections', { method: 'POST', body: fd, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function uploadAdditionalPhotos(inspectionId, inspection) {
    await ensureBlobs(inspection.photos);
    const fd = new FormData();
    fd.append('device_id',   inspection.device_id || '');
    fd.append('app_version', '1.0.0');
    buildPhotoFormData(fd, inspection.photos);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      return await api(`/api/inspections/${encodeURIComponent(inspectionId)}/photos`, {
        method: 'POST', body: fd, signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    fetchInspectors, fetchConfig, fetchTodayInspections, verifyPin,
    uploadInspection, uploadAdditionalPhotos,
  };
})();
