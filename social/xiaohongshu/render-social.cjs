const fs = require('fs');
const path = require('path');
const sharp = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');

const W = 1242;
const H = 1660;
const dir = __dirname;
const root = path.resolve(dir, '../..');
const iconData = fs.readFileSync(path.join(root, 'icons/icon128.png')).toString('base64');
const screenData = fs.readFileSync(path.join(root, 'store/screenshot-1280x800.png')).toString('base64');

const colors = {
  ink: '#0b1e2d',
  muted: '#547080',
  cyan: '#08a9d6',
  cyanDeep: '#007ba7',
  aqua: '#60e0d1',
  cream: '#f5f0e5',
  paper: '#fffdf7',
  orange: '#ff6a3d',
  yellow: '#ffd05a',
};

const sans = 'DengXian, Microsoft YaHei, Noto Sans CJK SC, sans-serif';
const serif = 'STZhongsong, SimSun, Noto Serif CJK SC, serif';

function xml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[c]);
}

function text(x, y, lines, size, opts = {}) {
  const {
    fill = colors.ink,
    weight = 400,
    family = sans,
    lineHeight = Math.round(size * 1.25),
    anchor = 'start',
    letterSpacing = 0,
  } = opts;
  const parts = (Array.isArray(lines) ? lines : [lines]).map((line, i) =>
    `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${xml(line)}</tspan>`
  ).join('');
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letterSpacing}">${parts}</text>`;
}

function roundRect(x, y, w, h, r, fill, stroke = 'none', sw = 0) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function eyebrow(label, x = 72, y = 105, dark = false) {
  return [
    roundRect(x, y - 20, 52, 8, 4, colors.orange),
    text(x + 72, y, label, 30, { fill: dark ? colors.aqua : colors.cyanDeep, weight: 700, letterSpacing: 2 }),
  ].join('');
}

function pageNo(n, dark = false) {
  return text(1170, 1596, `${String(n).padStart(2, '0')} / 04`, 25, {
    fill: dark ? '#ffffff70' : '#0b1e2d66', weight: 700, anchor: 'end', letterSpacing: 3,
  });
}

function base(content, background = colors.paper, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>${defs}</defs>
    <rect width="${W}" height="${H}" fill="${background}"/>
    ${content}
  </svg>`;
}

function cover() {
  const defs = `<linearGradient id="coverGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#08a9d6" stop-opacity=".32"/><stop offset="1" stop-color="#60e0d1" stop-opacity=".03"/>
    </linearGradient>`;
  const content = `
    <rect width="1242" height="1660" fill="#111321"/>
    <rect width="1242" height="1660" fill="url(#coverGlow)"/>
    ${roundRect(72, 72, 400, 62, 31, '#ffffff12', '#ffffff25', 2)}
    ${text(272, 113, '电脑端 · 浏览器扩展', 27, { fill: colors.aqua, weight: 700, anchor: 'middle', letterSpacing: 1 })}
    ${text(72, 330, ['B站视频', '怎么保存'], 126, { fill: '#ffffff', weight: 900, family: sans, lineHeight: 150 })}
    ${roundRect(66, 555, 600, 145, 12, colors.yellow)}
    ${text(86, 662, '到电脑？', 126, { fill: colors.ink, weight: 900, family: sans })}
    ${text(72, 860, '我做了个简单的浏览器扩展', 42, { fill: '#ffffffcc', weight: 600 })}
    ${roundRect(72, 1015, 1098, 350, 30, '#ffffff')}
    <image href="data:image/png;base64,${iconData}" x="118" y="1070" width="190" height="190"/>
    ${text(364, 1105, '打开普通视频页', 35, { fill: colors.muted, weight: 600 })}
    ${text(364, 1190, '点右下角按钮', 58, { fill: colors.ink, weight: 900 })}
    ${roundRect(364, 1242, 600, 70, 35, colors.cyan)}
    ${text(664, 1289, 'MP4 视频  /  M4A 音频', 28, { fill: '#ffffff', weight: 800, anchor: 'middle' })}
    ${text(72, 1485, 'Edge / Chrome 扩展商店已上架', 31, { fill: '#ffffff', weight: 700 })}
    ${text(72, 1545, '搜索「B站视频下载助手」', 29, { fill: colors.aqua, weight: 700 })}
    ${text(1170, 1575, '01 / 04', 25, { fill: '#ffffff66', weight: 700, anchor: 'end', letterSpacing: 3 })}
  `;
  return base(content, '#111321', defs);
}

function interfaceCard() {
  const content = `
    ${roundRect(64, 66, 208, 58, 29, colors.orange)}
    ${text(168, 105, '装好以后', 27, { fill: '#ffffff', weight: 800, anchor: 'middle' })}
    ${text(64, 264, ['视频右下角', '会多一个按钮'], 104, { fill: colors.ink, weight: 900, family: sans, lineHeight: 126 })}
    ${text(64, 547, '不用复制网址，也不用离开当前页面', 34, { fill: colors.muted, weight: 600 })}
    ${roundRect(64, 642, 1114, 720, 34, '#ffffff', colors.ink, 3)}
    <clipPath id="screenClip"><rect x="64" y="642" width="1114" height="720" rx="34"/></clipPath>
    <image href="data:image/png;base64,${screenData}" x="64" y="642" width="1114" height="720" preserveAspectRatio="xMaxYMid slice" clip-path="url(#screenClip)"/>
    ${roundRect(806, 686, 282, 72, 36, colors.orange)}
    ${text(947, 734, '下载按钮在这里', 28, { fill: '#ffffff', weight: 800, anchor: 'middle' })}
    <path d="M956 766 C968 825 1010 846 1058 878" fill="none" stroke="${colors.orange}" stroke-width="14" stroke-linecap="round"/>
    <path d="M1058 878 L1018 858 M1058 878 L1044 834" fill="none" stroke="${colors.orange}" stroke-width="14" stroke-linecap="round"/>
    ${roundRect(64, 1422, 1114, 104, 22, colors.ink)}
    ${text(621, 1488, '点开后，直接选清晰度和格式', 34, { fill: '#ffffff', weight: 800, anchor: 'middle' })}
    ${pageNo(2)}
  `;
  return base(content, '#f8f7f2');
}

function featuresCard() {
  const content = `
    ${roundRect(64, 66, 264, 58, 29, colors.cyan)}
    ${text(196, 105, '格式怎么选？', 27, { fill: '#ffffff', weight: 800, anchor: 'middle' })}
    ${text(64, 254, ['想要视频？', '还是只听声音？'], 96, { weight: 900, family: sans, lineHeight: 118 })}
    ${roundRect(64, 568, 1114, 336, 36, colors.cyan)}
    ${text(120, 684, 'MP4', 88, { fill: '#ffffff', weight: 900 })}
    ${text(120, 778, '保存视频', 48, { fill: '#ffffff', weight: 800 })}
    ${text(120, 842, '画面和声音都要，就选这个', 31, { fill: '#ffffffcc', weight: 600 })}
    ${roundRect(64, 948, 1114, 336, 36, colors.yellow)}
    ${text(120, 1064, 'M4A', 88, { fill: colors.ink, weight: 900 })}
    ${text(120, 1158, '只保存音频', 48, { fill: colors.ink, weight: 800 })}
    ${text(120, 1222, '只想听声音，就选这个', 31, { fill: colors.muted, weight: 600 })}
    ${roundRect(64, 1340, 1114, 150, 28, '#ffffff', colors.ink, 3)}
    ${text(621, 1403, '清晰度也可以自己选', 42, { weight: 900, anchor: 'middle' })}
    ${text(621, 1452, '页面有什么清晰度，扩展就显示什么', 27, { fill: colors.muted, weight: 600, anchor: 'middle' })}
    ${pageNo(3)}
  `;
  return base(content, '#f7f3e8');
}

function stepsCard() {
  const point = (y, title, body) => `
    <circle cx="116" cy="${y}" r="42" fill="${colors.aqua}"/>
    ${text(116, y + 14, '✓', 39, { fill: colors.ink, weight: 900, anchor: 'middle' })}
    ${text(188, y + 6, title, 44, { fill: '#ffffff', weight: 900 })}
    ${text(188, y + 58, body, 29, { fill: '#ffffffa8', weight: 600 })}`;
  const content = `
    <rect width="1242" height="1660" fill="#101522"/>
    ${roundRect(64, 66, 250, 58, 29, colors.orange)}
    ${text(189, 105, '分 P 视频', 27, { fill: '#ffffff', weight: 800, anchor: 'middle' })}
    ${text(64, 270, ['分P很多？', '让它自己排队下'], 98, { fill: '#ffffff', weight: 900, family: sans, lineHeight: 120 })}
    ${text(64, 548, '选好以后，可以放着让它慢慢处理', 34, { fill: '#ffffffa8', weight: 600 })}
    ${point(710, '最多 3 个任务一起下', '不用一个完成后再手动点下一个')}
    ${point(905, '可以暂停、继续、取消', '临时有事，随时停下来')}
    ${point(1100, '失败会重试，还有下载历史', '最近 50 条记录都保存在本地')}
    ${roundRect(64, 1268, 1114, 220, 30, '#ffffff')}
    ${text(110, 1344, 'Edge / Chrome 已上架', 42, { fill: colors.ink, weight: 900 })}
    ${text(110, 1404, '商店搜索「B站视频下载助手」', 30, { fill: colors.cyanDeep, weight: 800 })}
    ${text(110, 1454, 'Chrome 搜不到时，用正文里的直达链接', 25, { fill: colors.muted, weight: 600 })}
    ${text(64, 1550, '仅用于保存你有权使用的内容及个人学习', 23, { fill: '#ffffff72', weight: 600 })}
    ${text(1170, 1575, '04 / 04', 25, { fill: '#ffffff66', weight: 700, anchor: 'end', letterSpacing: 3 })}
  `;
  return base(content, '#101522');
}

async function run() {
  const cards = [cover(), interfaceCard(), featuresCard(), stepsCard()];
  for (let i = 0; i < cards.length; i += 1) {
    const target = path.join(dir, `launch-${String(i + 1).padStart(2, '0')}.png`);
    await sharp(Buffer.from(cards[i])).png({ compressionLevel: 9 }).toFile(target);
    console.log(target);
  }

  const thumbs = await Promise.all(cards.map((card) =>
    sharp(Buffer.from(card)).resize(555, 742).png().toBuffer()
  ));
  const preview = path.join(dir, 'launch-preview.png');
  await sharp({ create: { width: 1242, height: 1660, channels: 4, background: '#e8e7e2' } })
    .composite([
      { input: thumbs[0], left: 48, top: 48 },
      { input: thumbs[1], left: 639, top: 48 },
      { input: thumbs[2], left: 48, top: 870 },
      { input: thumbs[3], left: 639, top: 870 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(preview);
  console.log(preview);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
