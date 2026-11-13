// 由共用的樣式、畫面與邏輯產生三份頁面：
//   public/maju/checkout.html        原型伺服器版的 MAJU 確認頁（資料來自 server.js）
//   share/maju-demo.html             單檔示範頁（Claude Artifact 用的片段）
//   index.html、share/MAJU分期流程示範.html   單檔示範頁（完整 HTML，GitHub Pages 與離線開啟用）
// 用法：node build.js
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const write = (f, s) => { fs.writeFileSync(path.join(__dirname, f), s); console.log('wrote', f, s.length); };

const css = read('src/styles.css');
const majuView = read('src/maju-view.html');
const FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap">';
const BASE = '<style>body{margin:0;font-size:14px}img{max-width:100%}</style>';
const page = (title, head, body) => `<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${title}</title>\n${BASE}\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

// ---- 單檔示範頁 ----
const singleHead = `${FONT}\n<style>\n${css}</style>`;
const singleBody = `${read('src/shop-view.html')}\n${majuView.replace('<div id="majuView">', '<div id="majuView" hidden>')}\n<script>\n${read('lib/core.js')}\n${read('public/shared/maju-ui.js')}\n${read('src/single-app.js')}</script>`;
const TITLE = 'MAJU 分期付款流程示範';
write('share/maju-demo.html', `<title>${TITLE}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${singleHead}\n\n${singleBody}\n`);
const standalone = page(TITLE, singleHead, singleBody);
write('index.html', standalone);
write('share/MAJU分期流程示範.html', standalone);

// ---- 原型伺服器版確認頁（不內含計價規則） ----
write('public/maju/checkout.html', page('MAJU 付款確認', `${FONT}\n<style>\n${css}</style>`,
  `${majuView}\n<script src="/shared/maju-ui.js"></script>\n<script>\n${read('src/server-app.js')}</script>`));
