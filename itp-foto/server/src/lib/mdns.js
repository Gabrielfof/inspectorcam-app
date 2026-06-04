'use strict';

const { Bonjour } = require('bonjour-service');

let bonjour = null;
let service = null;

/**
 * Pornește advertisingul mDNS astfel încât telefoanele din rețeaua locală
 * să găsească serverul la itp-statie.local (sau via service discovery).
 *
 * @param {number} port - Portul pe care ascultă serverul Express
 */
function startMdns(port) {
  try {
    bonjour = new Bonjour();
    service = bonjour.publish({
      name: 'InspectorCam Server',
      type: 'http',
      port: port,
      txt: { path: '/', version: '1.0.0' },
    });

    service.on('up', () => {
      console.log(`[mDNS] Serviciu publicat: InspectorCam Server pe portul ${port}`);
      console.log('[mDNS] Telefoanele din rețea pot accesa serverul via service discovery');
    });

    service.on('error', (err) => {
      console.warn('[mDNS] Eroare la publicarea serviciului:', err.message);
    });
  } catch (err) {
    // mDNS este un plus de confort, nu oprește serverul dacă eșuează
    console.warn('[mDNS] Nu s-a putut porni mDNS:', err.message);
  }
}

/**
 * Oprește serviciul mDNS la închiderea serverului.
 */
function stopMdns() {
  return new Promise((resolve) => {
    if (!bonjour) return resolve();
    bonjour.unpublishAll(() => {
      bonjour.destroy();
      bonjour = null;
      service = null;
      resolve();
    });
  });
}

module.exports = { startMdns, stopMdns };
