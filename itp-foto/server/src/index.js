'use strict';

const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getDb } = require('./lib/database');
const { startMdns, stopMdns } = require('./lib/mdns');

// ID unic generat la fiecare pornire a serverului — forțează re-fetch JS/CSS pe telefon
const BUILD_ID = Date.now().toString(36);

const inspectorsRouter  = require('./routes/inspectors');
const configRouter      = require('./routes/config');
const inspectionsRouter = require('./routes/inspections');
const uploadRouter      = require('./routes/upload');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Calea PWA: setată de main.js (Electron) sau fallback pentru `npm start` direct
const PWA_PATH = process.env.PWA_PATH || path.join(__dirname, '..', '..', 'pwa');

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS — permite orice origine din rețeaua locală (PWA pe telefon)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// index.html — injectăm ?v=BUILD_ID în toate link-urile JS/CSS
// Astfel, chiar și un SW vechi nu va găsi URL-ul în cache și va cere fișierul de la server
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let html = fs.readFileSync(path.join(PWA_PATH, 'index.html'), 'utf8');
    html = html.replace(/(src|href)="(\/[^"]+\.(js|css))"/g, `$1="$2?v=${BUILD_ID}"`);
    res.type('html').send(html);
  } catch {
    res.sendFile(path.join(PWA_PATH, 'index.html'));
  }
});

// Serve PWA static — JS/CSS/HTML fără cache, iconuri pot fi cache-uite
app.use(express.static(PWA_PATH, {
  setHeaders(res, filePath) {
    if (
      filePath.endsWith('.js') ||
      filePath.endsWith('.css') ||
      filePath.endsWith('.html')
    ) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// Rute API
app.use('/api/inspectors',   inspectorsRouter);
app.use('/api/config',       configRouter);
app.use('/api/inspections',  inspectionsRouter);
app.use('/api/inspections',  uploadRouter);   // POST /api/inspections — upload

// Health check — util pentru a verifica că serverul e live
app.get('/api/health', (req, res) => {
  const db = getDb();
  const inspCount = db.prepare("SELECT COUNT(*) AS n FROM inspections").get().n;
  const localIp = getLocalIp();
  res.json({
    ok: true,
    status: 'online',
    ip: localIp,
    port: PORT,
    inspections_today: db.prepare("SELECT COUNT(*) AS n FROM inspections WHERE date(datetime) = date('now')").get().n,
    total_inspections: inspCount,
    version: '1.0.0',
  });
});

// 404 fallback pentru rute necunoscute
app.use((req, res) => {
  res.status(404).json({ ok: false, eroare: `Ruta ${req.method} ${req.path} nu există.` });
});

// Error handler global
app.use((err, req, res, _next) => {
  console.error('[server] Eroare neașteptată:', err.message);
  res.status(500).json({ ok: false, eroare: err.message || 'Eroare internă de server.' });
});

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      candidates.push(iface.address);
    }
  }
  // Preferăm 192.168.x.x (WiFi router obișnuit), apoi 10.x.x.x (rețea corporate)
  // Evităm 172.16-31.x.x care de obicei e hotspot iPhone sau VPN
  const wifi = candidates.find(ip => ip.startsWith('192.168.'));
  if (wifi) return wifi;
  const corp = candidates.find(ip => ip.startsWith('10.'));
  if (corp) return corp;
  return candidates[0] || '127.0.0.1';
}

let _server = null;

function start() {
  return new Promise((resolve, reject) => {
    getDb(); // init DB
    _server = app.listen(PORT, '0.0.0.0', () => {
      const ip = getLocalIp();
      console.log('');
      console.log('╔══════════════════════════════════════════╗');
      console.log('║        InspectorCam Server — v1.0.0          ║');
      console.log('╠══════════════════════════════════════════╣');
      console.log(`║  Local:    http://localhost:${PORT}         ║`);
      console.log(`║  Rețea:    http://${ip}:${PORT}  ║`);
      console.log('╚══════════════════════════════════════════╝');
      console.log('');
      startMdns(PORT);
      resolve({ port: PORT, ip });
    });
    _server.on('error', reject);
  });
}

function stop() {
  return new Promise(resolve => {
    stopMdns().catch(() => {}).then(() => {
      if (_server) {
        // Inchide fortat toate conexiunile keep-alive (altfel close() nu se termina niciodata)
        if (typeof _server.closeAllConnections === 'function') _server.closeAllConnections();
        _server.close(() => resolve());
        setTimeout(resolve, 2000); // safety: max 2 secunde
      } else {
        resolve();
      }
    });
  });
}

// Pornire directă cu `npm start` sau `node src/index.js`
if (require.main === module) {
  start().catch(err => { console.error('[server] Eroare pornire:', err.message); process.exit(1); });

  function shutdown() {
    console.log('\n[server] Oprire server...');
    stop().then(() => { console.log('[server] Server oprit.'); process.exit(0); });
  }
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { app, start, stop };
