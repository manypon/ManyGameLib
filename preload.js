'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const COMMANDS = new Set([
  'get_version', 'get_games', 'get_missing', 'get_assets', 'preview_image',
  'add_game', 'update_game', 'launch_game', 'toggle_favorite', 'remove_game',
  'win_state', 'get_settings', 'save_settings', 'reset_settings',
  'get_app_info', 'open_external', 'get_update_state', 'file_icon', 'check_update', 'download_update', 'install_update',
  'get_wallpaper', 'set_wallpaper', 'clear_wallpaper',
]);

contextBridge.exposeInMainWorld('api', {
  invoke: async (cmd, args) => {
    if (!COMMANDS.has(cmd)) throw `Неизвестная команда: ${cmd}`;
    const res = await ipcRenderer.invoke(cmd, args || {});
    if (res && res.error) throw res.error;
    return res ? res.data : undefined;
  },
  pickFile: async (opts) => {
    const res = await ipcRenderer.invoke('pick_file', opts || {});
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  },
  // Путь к файлу, перетащенному в окно (у File в новых Electron свойства path больше нет).
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  win: (action) => ipcRenderer.send('win', action),
  onUpdateState: (cb) => ipcRenderer.on('update-state', (_event, s) => cb(s)),
  onGameUpdated: (cb) => ipcRenderer.on('game-updated', (_event, g) => cb(g)),
  onWinState: (cb) => ipcRenderer.on('win-state', (_event, maximized) => cb(!!maximized)),
});
