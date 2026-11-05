'use strict';

const { app, BrowserWindow, ipcMain, shell, Notification, dialog, Menu } = require('electron');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const https = require('https');
let autoUpdater = null;
let pendingUpdateFile = null;

app.setName('InspectorCam');

// Fix ecran negru pe Windows cu plăci video incompatibile
if (process.platform === 'win32') app.disableHardwareAcceleration();

// Permitem o singură instanță a aplicației
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow     = null;
let settingsWindow = null;
let licenseWindow  = null;
let serverInfo     = null;
let stopServer     = null;
let licenseInfo    = null;

const LICENSE_SERVER = 'https://inspectorcam-licenses.onrender.com';
const GRACE_DAYS     = 7;

function licenseFilePath() {
  return path.join(app.getPath('userData'), 'license.json');
}

function readStoredLicense() {
  try {
    const f = licenseFilePath();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return null;
}

function storeLicense(data) {
  fs.writeFileSync(licenseFilePath(), JSON.stringify(data, null, 2), 'utf8');
}

function getMachineId() {
  const filePath = path.join(app.getPath('userData'), 'machine-id.json');
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')).id;
  } catch {}
  const id = require('crypto').randomUUID();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ id }), 'utf8');
  return id;
}

function verifyOnline(key) {
  return new Promise((resolve, reject) => {
    const machineId = getMachineId();
    const url = `${LICENSE_SERVER}/api/verify?key=${encodeURIComponent(key)}&machine_id=${encodeURIComponent(machineId)}`;
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Răspuns invalid')); }
      });
    }).on('error', reject);
  });
}

async function checkLicense() {
  const stored = readStoredLicense();
  if (!stored || !stored.key) return false;

  try {
    const result = await verifyOnline(stored.key);
    if (result.valid) {
      const updated = { ...stored, expires_at: result.expires_at, last_check: new Date().toISOString(), error: null };
      storeLicense(updated);
      licenseInfo = { key: stored.key, expires_at: result.expires_at, station_name: result.station_name };
      return true;
    }
    storeLicense({ ...stored, error: result.error });
    return false;
  } catch {
    // Offline — folosim grace period
    if (stored.last_check) {
      const days = (Date.now() - new Date(stored.last_check)) / 86_400_000;
      if (days <= GRACE_DAYS) {
        licenseInfo = { key: stored.key, expires_at: stored.expires_at, station_name: stored.station_name };
        return true;
      }
    }
    return false;
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
    autoSyncPwa();
  }

  process.env.PWA_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'pwa')
    : path.join(__dirname, '..', '..', '..', 'pwa');

  // Verificare licență
  const valid = await checkLicense();
  if (!valid) {
    createLicenseWindow();
    return;
  }

  await startMainApp();
});

async function startMainApp() {
  const server = require('../index');
  stopServer = server.stop;

  try {
    serverInfo = await server.start();
  } catch (err) {
    console.error('[electron] Server nu a pornit:', err.message);
    app.quit();
    return;
  }

  const { createTray } = require('./tray');
  mainWindow = createDashboardWindow();
  createTray(app, mainWindow, openSettings, quit, serverInfo);

  if (app.isPackaged) {
    setupAutoUpdater();
  }
}

// Pe Mac lansează un shell script care înlocuiește .app DUPĂ ce procesul curent se închide.
// Ocolim complet quitAndInstall (care eșuează silențios pe Mac fără code signing).
//
// Înlocuirea e sigură: aplicația nouă se copiază întâi lângă cea veche, apoi se fac
// două redenumiri (veche → deoparte, nouă → la loc). Redenumirea către un nume care
// nu există nu poate pune niciodată aplicația „în interiorul” celei vechi (versiunile
// ≤ 1.5.5 făceau rm -rf + cp -R, iar două instalări simultane lăsau
// InspectorCam.app/InspectorCam.app — „damaged or incomplete”).
function macUpdateScript(zipPath, appBundle) {
  return [
    '#!/bin/bash',
    `ZIPPATH="${zipPath}"`,
    `APPBUNDLE="${appBundle}"`,
    // O singură instalare odată
    'LOCK="${TMPDIR:-/tmp}/inspectorcam_update.lock"',
    'if ! mkdir "$LOCK" 2>/dev/null; then',
    // incuietoare ramasa de la o instalare intrerupta (mai veche de 10 minute) → o refolosim
    '  [ $(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || date +%s) )) -gt 600 ] || exit 0',
    '  rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0',
    'fi',
    'TMPDIR_EXTRACT=""',
    'trap \'rm -rf "$TMPDIR_EXTRACT"; rmdir "$LOCK" 2>/dev/null\' EXIT',
    // Asteapta inchiderea tuturor proceselor aplicatiei (principal + helpere), max 30 secunde
    'for i in $(seq 1 30); do',
    '  pgrep -f "$APPBUNDLE/Contents/" > /dev/null || break',
    '  sleep 1',
    'done',
    '[ -f "$ZIPPATH" ] || exit 1',
    '[ -d "$APPBUNDLE" ] || exit 1',
    // Extrage arhiva si verifica aplicatia noua
    'TMPDIR_EXTRACT=$(mktemp -d)',
    'ditto -x -k "$ZIPPATH" "$TMPDIR_EXTRACT" || { open "$APPBUNDLE"; exit 1; }',
    'NEWAPP=$(find "$TMPDIR_EXTRACT" -maxdepth 2 -type d -name "*.app" | head -1)',
    '[ -n "$NEWAPP" ] && [ -f "$NEWAPP/Contents/Info.plist" ] && [ -d "$NEWAPP/Contents/MacOS" ] || { open "$APPBUNDLE"; exit 1; }',
    // Copie langa aplicatia veche, apoi redenumiri
    'STAGE="${APPBUNDLE%.app}.update-$$.app"',
    'OLD="${APPBUNDLE%.app}.old-$$.app"',
    'rm -rf "$STAGE" "$OLD"',
    'ditto "$NEWAPP" "$STAGE" || { rm -rf "$STAGE"; open "$APPBUNDLE"; exit 1; }',
    'mv "$APPBUNDLE" "$OLD" || { rm -rf "$STAGE"; open "$APPBUNDLE"; exit 1; }',
    'if mv "$STAGE" "$APPBUNDLE"; then',
    '  rm -rf "$OLD"',
    'else',
    '  mv "$OLD" "$APPBUNDLE"',
    '  rm -rf "$STAGE"',
    'fi',
    // Elimina Gatekeeper quarantine (esential pe Mac fara code signing)
    'xattr -rd com.apple.quarantine "$APPBUNDLE" 2>/dev/null || true',
    // Porneste aplicatia (noua sau, la eroare, cea veche)
    'open "$APPBUNDLE"',
  ].join('\n');
}

function launchMacUpdateScript(zipPath, appBundle) {
  if (!zipPath || !appBundle) return false;
  const { spawn } = require('child_process');
  const scriptPath = path.join(os.tmpdir(), `inspectorcam_update_${process.pid}.sh`);
  try {
    fs.writeFileSync(scriptPath, macUpdateScript(zipPath, appBundle), { mode: 0o755 });
    const child = spawn('bash', [scriptPath], { detached: true, stdio: 'ignore' });
    child.unref();
    console.log('[updater] Script update Mac lansat:', scriptPath);
    return true;
  } catch (e) {
    console.error('[updater] launchMacUpdateScript error:', e.message);
    return false;
  }
}

// Instalarea pornește o singură dată — butonul „Repornește acum” și pornirea
// automată după 8 secunde pot veni aproape simultan
let installStarted = false;

function triggerInstall() {
  if (installStarted) return;
  installStarted = true;
  app.isQuitting = true;

  if (process.platform === 'darwin') {
    const appBundle = path.dirname(path.dirname(path.dirname(app.getPath('exe'))));
    launchMacUpdateScript(pendingUpdateFile, appBundle);
    // Force-close procesul curent dupa 2 secunde, indiferent de orice
    setTimeout(() => app.exit(0), 2000);
  } else {
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (e) {
      console.error('[updater] quitAndInstall error:', e.message);
      app.quit();
    }
  }
}

function setupAutoUpdater() {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', err => {
    console.error('[updater] Eroare:', err.message);
  });

  autoUpdater.on('update-available', info => {
    console.log('[updater] Actualizare disponibilă:', info.version);
    if (mainWindow) mainWindow.webContents.send('update-available', { version: info.version });
  });

  autoUpdater.on('download-progress', progress => {
    console.log(`[updater] Descărcare: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', info => {
    console.log('[updater] Descărcare completă:', info.version);
    pendingUpdateFile = info.downloadedFile || null;
    console.log('[updater] Fișier descărcat:', pendingUpdateFile);
    if (mainWindow) mainWindow.webContents.send('update-downloaded', { version: info.version });
    // Instalare automată după 8 secunde
    setTimeout(triggerInstall, 8000);
  });

  autoUpdater.checkForUpdates().catch(err => console.error('[updater] checkForUpdates:', err.message));
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1_000);
}

// A doua instanță încearcă să pornească → aducem prima în față
app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('window-all-closed', e => {
  if (!app.isQuitting) e.preventDefault();
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (stopServer) {
    // Timeout 2s: nu permite serverului sa blocheze inchiderea aplicatiei
    await Promise.race([
      stopServer().catch(() => {}),
      new Promise(r => setTimeout(r, 2000)),
    ]);
  }
});

// Meniu aplicație macOS (Cmd+Q)
app.on('ready', () => {
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Închide InspectorCam', accelerator: 'CmdOrCtrl+Q', click: quit },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
});

// ── License window ───────────────────────────────────────────────────────────

function createLicenseWindow() {
  licenseWindow = new BrowserWindow({
    width: 480,
    height: 520,
    resizable: false,
    title: 'InspectorCam — Activare',
    backgroundColor: '#0B0E15',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  licenseWindow.loadFile(path.join(__dirname, 'license-ui.html'));
  licenseWindow.on('closed', () => { licenseWindow = null; });
}

ipcMain.handle('activate-license', async (_, key) => {
  try {
    const result = await verifyOnline(key.trim().toUpperCase());
    if (result.valid) {
      const k = key.trim().toUpperCase();
      storeLicense({ key: k, expires_at: result.expires_at, station_name: result.station_name, last_check: new Date().toISOString() });
      licenseInfo = { key: k, expires_at: result.expires_at, station_name: result.station_name };
      if (licenseWindow) { licenseWindow.close(); licenseWindow = null; }
      await startMainApp();
      return { ok: true };
    }
    return { ok: false, error: result.error || 'Cheie invalidă.' };
  } catch {
    return { ok: false, error: 'Nu s-a putut conecta la serverul de licențe. Verificați conexiunea la internet.' };
  }
});

// ── Windows ───────────────────────────────────────────────────────────────────

function createDashboardWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'InspectorCam — Dashboard',
    backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, 'dashboard.html'));

  win.on('close', e => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: 'InspectorCam rulează în fundal',
          body:  'Aplicația continuă să funcționeze. Accesați din iconița din tray.',
        }).show();
      }
    }
  });

  return win;
}

function openSettings(tab) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    if (tab) settingsWindow.webContents.send('switch-tab', tab);
    return;
  }
  settingsWindow = new BrowserWindow({
    width:  720,
    height: 620,
    title:  'InspectorCam — Setări',
    backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings-ui.html'),
    tab ? { hash: tab } : undefined
  );
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

async function quit() {
  const { response } = await dialog.showMessageBox({
    type:    'question',
    buttons: ['Oprește serverul', 'Anulează'],
    defaultId: 0,
    cancelId:  1,
    title:   'Închide InspectorCam',
    message: 'Oprești serverul InspectorCam?',
    detail:  'Telefonul nu va mai putea trimite fotografii până la repornire.',
  });
  if (response === 0) {
    app.isQuitting = true;
    app.quit();
  }
}

// ── Noutățile versiunii ───────────────────────────────────────────────────────

// Ultima versiune pornită — ca să știm când aplicația tocmai a fost actualizată
function versionStatePath() {
  return path.join(app.getPath('userData'), 'version-state.json');
}

function readVersionState() {
  try { return JSON.parse(fs.readFileSync(versionStatePath(), 'utf8')) || {}; } catch { return {}; }
}

function writeVersionState(state) {
  try { fs.writeFileSync(versionStatePath(), JSON.stringify(state)); } catch {}
}

// Clienții care au avut deja aplicația (spre deosebire de o instalare nouă)
function hasExistingData() {
  try {
    const db = require('../lib/database').getDb();
    const n = db.prepare('SELECT (SELECT COUNT(*) FROM inspectors) + (SELECT COUNT(*) FROM inspections) AS n').get().n;
    return n > 0;
  } catch { return false; }
}

// 1.5.10 > 1.5.9 (comparație pe numere, nu pe text)
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// O singură dată, la prima pornire după actualizare: noutățile tuturor versiunilor
// sărite (de după versiunea avută până la cea curentă), fără punctele deja văzute
ipcMain.handle('get-whats-new', () => {
  try {
    const current = app.getVersion();
    const state = readVersionState();
    const last = state.lastVersion || null;
    if (last === current) return null;
    writeVersionState({ ...state, lastVersion: current });
    if (!last && !hasExistingData()) return null;   // instalare nouă

    const all = require('./release-notes.json');
    const versions = Object.keys(all).sort(compareVersions);
    // Fără versiune salvată = actualizare de pe ≤ 1.5.4 → toate noutățile până acum
    const seen = new Set(last ? versions.filter(v => compareVersions(v, last) <= 0).flatMap(v => all[v] || []) : []);
    const notes = [];
    for (const v of versions.filter(v => (!last || compareVersions(v, last) > 0) && compareVersions(v, current) <= 0).reverse()) {
      for (const n of all[v] || []) {
        if (!seen.has(n)) { seen.add(n); notes.push(n); }
      }
    }
    return notes.length ? { version: current, notes } : null;
  } catch {
    return null;
  }
});

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('get-server-info', () => serverInfo);
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-license-info', () => licenseInfo);
ipcMain.handle('install-update', () => {
  if (!autoUpdater) return;
  triggerInstall();
});

ipcMain.handle('choose-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Selectați folderul de salvare fotografii',
  });
  return canceled ? null : filePaths[0];
});

ipcMain.on('open-itp-folder', () => {
  try {
    const { getDb } = require('../lib/database');
    const row = getDb().prepare("SELECT value FROM config WHERE key = 'save_folder'").get();
    const folderPath = (row && row.value) ? row.value : path.join(os.homedir(), 'InspectorCam');
    fs.mkdirSync(folderPath, { recursive: true });
    shell.openPath(folderPath);
  } catch {
    const fallback = path.join(os.homedir(), 'InspectorCam');
    fs.mkdirSync(fallback, { recursive: true });
    shell.openPath(fallback);
  }
});

ipcMain.on('open-settings', (event, tab) => openSettings(tab));

// Jurnalul de diagnostic trimis de telefoane — deschis în Finder / Explorer
ipcMain.on('open-client-log', () => {
  shell.showItemInFolder(require('../routes/clientLog').ensureLogFile());
});

ipcMain.on('quit-app', quit);

// ── Auto-sync PWA ─────────────────────────────────────────────────────────────

function autoSyncPwa() {
  try {
    const srcPathFile = path.join(__dirname, '..', 'pwa-source-path.json');
    if (!fs.existsSync(srcPathFile)) return;

    const srcPwa  = JSON.parse(fs.readFileSync(srcPathFile, 'utf8')).path;
    const destPwa = path.join(process.resourcesPath, 'pwa');

    if (!fs.existsSync(srcPwa) || !fs.existsSync(destPwa)) return;

    let count = 0;
    for (const file of fs.readdirSync(srcPwa)) {
      if (fs.statSync(path.join(srcPwa, file)).isFile()) {
        fs.copyFileSync(path.join(srcPwa, file), path.join(destPwa, file));
        count++;
      }
    }
    console.log(`[electron] PWA sincronizat automat: ${count} fișiere`);
  } catch (e) {
    console.warn('[electron] Auto-sync PWA eșuat:', e.message);
  }
}
