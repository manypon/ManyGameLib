'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const COMMANDS = new Set([
  'get_games', 'preview_icon', 'add_game', 'launch_game', 'toggle_favorite', 'remove_game',
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
});
