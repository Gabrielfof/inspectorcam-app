'use strict';

const Storage = (() => {
  const DB_NAME    = 'inspectorcam';
  const DB_VERSION = 1;
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
      };

      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = () => reject(req.error);
    });
  }

  async function savePending(inspection) {
    const d = await open();
    return new Promise((resolve, reject) => {
      // Blobs can't be stored directly in older browsers; convert to ArrayBuffer
      const tx    = d.transaction('pending', 'readwrite');
      const store = tx.objectStore('pending');
      store.put(inspection);
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

  return { savePending, getPending, deletePending };
})();
