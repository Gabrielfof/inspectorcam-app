'use strict';

const Storage = (() => {
  const DB_NAME    = 'inspectorcam';
  const DB_VERSION = 3;
  let db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('pending')) {
          const store = d.createObjectStore('pending', { keyPath: 'id' });
          store.createIndex('by_date', 'datetime');
        }
        // v2: cazuri active persisted (supraviețuiesc la sleep/reload)
        if (!d.objectStoreNames.contains('active_plates')) {
          d.createObjectStore('active_plates', { keyPath: 'id' });
        }
        // v2: cazuri finalizate (permite re-adăugare poze)
        if (!d.objectStoreNames.contains('completed_plates')) {
          d.createObjectStore('completed_plates', { keyPath: 'id' });
        }
      };

      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = () => reject(req.error);
    });
  }

  /* ---- Pending (offline queue) ---- */

  async function savePending(inspection) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('pending', 'readwrite');
      tx.objectStore('pending').put(inspection);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  async function getPending() {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx  = d.transaction('pending', 'readonly');
      const req = tx.objectStore('pending').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  async function deletePending(id) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('pending', 'readwrite');
      tx.objectStore('pending').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  /* ---- Active plates (F2: persistă cazuri în curs) ---- */

  async function saveActivePlate(inspection) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('active_plates', 'readwrite');
      tx.objectStore('active_plates').put(inspection);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  async function getActivePlates() {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx  = d.transaction('active_plates', 'readonly');
      const req = tx.objectStore('active_plates').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  async function deleteActivePlate(id) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('active_plates', 'readwrite');
      tx.objectStore('active_plates').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  async function clearActivePlates() {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('active_plates', 'readwrite');
      tx.objectStore('active_plates').clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  /* ---- Completed plates (F3: permite re-adăugare poze) ---- */

  async function saveCompletedPlate(data) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('completed_plates', 'readwrite');
      tx.objectStore('completed_plates').put(data);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  async function getCompletedPlates() {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx  = d.transaction('completed_plates', 'readonly');
      const req = tx.objectStore('completed_plates').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  async function deleteCompletedPlate(id) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('completed_plates', 'readwrite');
      tx.objectStore('completed_plates').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  return {
    savePending, getPending, deletePending,
    saveActivePlate, getActivePlates, deleteActivePlate, clearActivePlates,
    saveCompletedPlate, getCompletedPlates, deleteCompletedPlate,
  };
})();
