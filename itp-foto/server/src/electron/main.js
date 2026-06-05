'use strict';

const { app, BrowserWindow, ipcMain, shell, Notification, dialog, Menu } = require('electron');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const https = require('https');
let autoUpdater = null;

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

function verifyOnline(key) {
  return new Promise((resolve, reject) => {
    const url = `${LICENSE_SERVER}/api/verify?key=${encodeURIComponent(key)}`;
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
    if (mainWindow) mainWindow.webContents.send('update-downloaded', { version: info.version });
    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true);
    }, 3000);
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
  if (stopServer) await stopServer().catch(() => {});
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
    height: 400,
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

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('get-server-info', () => serverInfo);
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-license-info', () => licenseInfo);
ipcMain.handle('install-update', () => { if (autoUpdater) autoUpdater.quitAndInstall(); });

ipcMain.handle('choose-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Selectați folderul de salvare fotografii',
  });
  return canceled ? null : filePaths[0];
});

ipcMain.on('open-itp-folder', () => {
  shell.openPath(path.join(os.homedir(), 'InspectorCam'));
});

ipcMain.on('open-settings', (event, tab) => openSettings(tab));

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
