'use strict';

/* Вписывает иконку и сведения о программе прямо в ManyGameLib.exe.
   Без этого exe остаётся с иконкой Electron (атом), и её видят ярлыки, поиск Windows и панель задач.
   Встроенный в electron-builder способ (signAndEditExecutable) требует скачать winCodeSign и права на символьные ссылки,
   на обычной Windows он падает с EPERM, поэтому используем пакет rcedit напрямую. */

const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const rcedit = require('rcedit');
  const info = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${info.productFilename}.exe`);
  await rcedit(exe, {
    icon: path.join(context.packager.projectDir, 'build', 'icon.ico'),
    'file-version': info.version,
    'product-version': info.version,
    'version-string': {
      ProductName: 'ManyGameLib',
      FileDescription: 'ManyGameLib',
      InternalName: 'ManyGameLib',
      OriginalFilename: `${info.productFilename}.exe`,
      CompanyName: 'manypon',
      LegalCopyright: 'MIT License',
    },
  });
};
