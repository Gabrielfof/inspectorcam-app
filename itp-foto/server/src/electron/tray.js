'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os   = require('os');

function createTray(app, mainWindow, openSettings, quit, serverInfo) {
  const iconPath = path.join(__dirname, '..', '..', '..', 'pwa', 'icons', 'tray-icon.png');
  const img  = nativeImage.createFromPath(iconPath);
  const icon = img.isEmpty() ? nativeImage.createEmpty() : img;

  const tray = new Tray(icon);
  tray.setToolTip(`InspectorCam  ·  http://${serverInfo.ip}:${serverInfo.port}`);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Deschide dashboard',
      click: () => { mainWindow.show(); mainWindow.focus(); },
    },
    {
      label: 'Deschide folder InspectorCam',
      click: () => {
        const { shell } = require('electron');
        shell.openPath(path.join(os.homedir(), 'InspectorCam'));
      },
    },
    { label: 'Setări', click: openSettings },
    { type: 'separator' },
    {
      label: `Server: http://${serverInfo.ip}:${serverInfo.port}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Închide InspectorCam',
      click: quit,
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });

  return tray;
}

module.exports = { createTray };
