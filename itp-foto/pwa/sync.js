'use strict';

const Sync = (() => {
  // Since the PWA is served by the Node server, same origin = server URL.
  const BASE = window.location.origin;

  async function api(path, options = {}) {
    const res = await fetch(BASE + path, options);
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

  async function uploadInspection(inspection) {
    const fd = new FormData();
    fd.append('plate',        inspection.plate);
    fd.append('inspector_id', inspection.inspector_id);
    fd.append('datetime',     inspection.datetime);
    fd.append('notes',        inspection.notes || '');
    fd.append('device_id',   inspection.device_id || '');
    fd.append('app_version',  '1.0.0');

    const meta = inspection.photos.map(p => ({
      step:      p.step,
      note:      p.note      || '',
      source:    p.source    || 'camera',
      ocr_plate: p.ocr_plate || null,
      timestamp: p.timestamp,
    }));
    fd.append('photos_meta', JSON.stringify(meta));

    inspection.photos
      .filter(p => p.blob instanceof Blob && p.blob.size > 0)
      .forEach(p => fd.append('files', p.blob, `${p.step}.jpg`));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      return await api('/api/inspections', { method: 'POST', body: fd, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function uploadAdditionalPhotos(inspectionId, inspection) {
    const fd = new FormData();
    fd.append('device_id',  inspection.device_id || '');
    fd.append('app_version', '1.0.0');

    const meta = inspection.photos.map(p => ({
      step:      p.step,
      note:      p.note      || '',
      source:    p.source    || 'camera',
      ocr_plate: p.ocr_plate || null,
      timestamp: p.timestamp,
    }));
    fd.append('photos_meta', JSON.stringify(meta));

    inspection.photos
      .filter(p => p.blob instanceof Blob && p.blob.size > 0)
      .forEach(p => fd.append('files', p.blob, `${p.step}.jpg`));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      return await api(`/api/inspections/${encodeURIComponent(inspectionId)}/photos`, {
        method: 'POST', body: fd, signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return { fetchInspectors, fetchConfig, fetchTodayInspections, verifyPin, uploadInspection, uploadAdditionalPhotos };
})();
