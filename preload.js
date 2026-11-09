'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const COMMANDS = new Set([
  'get_version', 'get_games', 'get_missing', 'get_assets', 'preview_image',
  'add_game', 'update_game', 'launch_game', 'toggle_favorite', 'remove_game',
  'win_state',
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
  win: (action) => ipcRenderer.send('win', action),
  onWinState: (cb) => ipcRenderer.on('win-state', (_event, maximized) => cb(!!maximized)),
});
