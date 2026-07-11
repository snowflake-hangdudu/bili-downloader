# B站视频下载助手 — 开发者文档

> 版本：2.2.1 | Manifest V3 | 最后更新：2026-07  
> 本文档供后续维护、改 bug、加功能时阅读。**新对话请先通读本文 + `manifest.json`。**

---

## 1. 功能概述

在 B 站视频页（`/video/*`、`/bangumi/play/*`）注入右下角悬浮面板，用户可：

| 能力 | 说明 |
|------|------|
| 解析视频 | 从 URL 识别 BV/aid，获取 aid、cid、分 P 列表、标题 |
| 清晰度列表 | 仅展示**真实可下载**的清晰度（过滤虚假 1080P/4K） |
| 低清下载 | 720P 及以下走 `fnval=1` **durl 单文件**，直接得 `.mp4` |
| 高清下载 | DASH 分轨下载 video.m4s + audio.m4s，**纯 JS 合并**为 `.mp4` |
| CDN 容错 | 镜像节点探测、backupUrl 优先、播放器资源嗅探 |

**不做的事：** 不破解会员、不绕过付费番剧、不上传任何数据到第三方服务器。

---

## 2. 项目结构

```
bilibili-downloader/
├── manifest.json          # 扩展配置（版本号以此为准）
├── background.js          # Service Worker，仅 onInstalled 日志
├── content/
│   ├── page-agent.js      # ★ MAIN world：API、CDN 下载、合并
│   ├── content.js         # ★ ISOLATED world：UI、postMessage 桥接
│   └── content.css        # 悬浮面板样式
├── popup/
│   ├── popup.html/js/css  # 工具栏弹窗（说明页）
├── lib/
│   ├── mp4-remux.iife.js  # 第三方：DASH m4s 无损合并
│   └── m4s-mux.js         # 封装 mergeM4s 供 page-agent 调用
├── icons/                 # 16/48/128 图标
├── scripts/pack.py        # 打开发布 zip
└── test/
    ├── test_merge_auto.mjs  # 自动测试：下载+合并（node）
    └── test_*.py            # API/CDN 探测脚本
```

### 已删除的冗余文件（勿恢复）

- `lib/bili-api.js`、`lib/downloader.js`、`lib/wbi.js` — v1 后台方案
- `content/bili-api.js` — 旧 content API
- `lib/ffmpeg/*` — 已弃用 FFmpeg.wasm（SharedArrayBuffer 问题）

---

## 3. 架构：双 World + postMessage

B 站 CDN 对扩展后台 `fetch` 返回 **403**，因此**必须在页面 MAIN world** 里下载（与播放器共享 Cookie/Referer）。

```
┌─────────────────────────────────────────────────────────────┐
│  B 站页面                                                    │
│  ┌──────────────────────┐    postMessage    ┌─────────────┐ │
│  │ page-agent.js        │ ◄──────────────► │ content.js  │ │
│  │ (MAIN world)         │   PANEL/AGENT    │ (ISOLATED)  │ │
│  │ - B 站 API fetch     │                  │ - UI 面板   │ │
│  │ - CDN 下载           │                  │ - 触发保存  │ │
│  │ - mp4-remux 合并     │                  │             │ │
│  └──────────────────────┘                  └─────────────┘ │
│         ▲ 注入脚本                              ▲ chrome.*  │
│         │ mp4-remux.iife.js                     │           │
│         │ m4s-mux.js                            │           │
└─────────────────────────────────────────────────────────────┘
```

### 通信协议

**content → page-agent**（`source: 'bili-dl-panel'`）：

| type | 参数 | 返回 data |
|------|------|-----------|
| `PARSE_URL` | `href` | `{ idInfo }` |
| `RESOLVE_VIDEO` | `href, pageIndex` | `{ info: { aid, cid, title, pages } }` |
| `GET_QUALITIES` | `aid, cid` | `{ qualities[], maxQn, maxLabel }` |
| `START_DOWNLOAD` | `aid, cid, qn, title` | 见下文 |

**page-agent → content**（`source: 'bili-dl-agent'`）：

| type | 说明 |
|------|------|
| `OK` / `ERR` | 带 `id` 响应 agentCall |
| `LOG` | `{ step, msg }` 调试日志 |
| `PROGRESS` | `{ phase, progress }` 进度 |

**关键常量（两处必须一致）：**

```javascript
const PANEL = 'bili-dl-panel';  // content.js 发出
const AGENT = 'bili-dl-agent';  // page-agent.js 发出
```

---

## 4. 核心流程

### 4.1 打开面板

1. `content.js` `mountUI()` 在 `document.body` 挂载右下角按钮
2. 点击按钮 → `loadVideoInfo()` → 串行 `agentCall`

### 4.2 获取清晰度 `getQualities()`

调用：`/x/player/playurl?qn=80&fnval=16&fourk=1`

- 从 `dash.video` 收集真实存在的 `id`（qn）
- `support_formats` 里每一项：
  - `dashIds.has(qn)` → 可 DASH 下载
  - `qn <= 64` → 可 durl 单文件
  - 否则 **隐藏**（避免假 1080P）

**重要：** 播放器显示的 1080P ≠ 一定有 1080P 片源。以 `dash.video` 的 `id` 为准。

### 4.3 下载 `handleDownload()`

```
qn <= 64  → 优先 fnval=1 durl → 单文件 .mp4 → saveBlob (MAIN world)
qn > 64   → fnval=16 DASH
              → pageDownload 视频轨
              → pageDownload 音频轨
              → mergeM4sInPage (mp4-remux)
              → 返回 ArrayBuffer 给 content.js
              → content.js <a download> 保存
```

### 4.4 CDN 下载 `pageDownload()`

1. `extractStreamUrls()`：从 `baseUrl` + `backupUrl` 取地址，**跳过 mcdn P2P**
2. `pickWorkingUrl()`：Range 探测 `bytes=0-1`，镜像替换后选可用节点
3. `fetch` 全量拉取，带 `Referer: https://www.bilibili.com/`

**镜像列表**（`MIRRORS` in page-agent.js）：

```
upos-sz-mirrorali / mirrorcos / mirrorbos / mirrorhw / mirror08c / mirrorhwo1
```

签名与 hostname 无关，可替换（社区共识，参考 BiliKit / bilibili-cdn-switcher）。

### 4.5 合并 `mergeM4sInPage()`

依赖页面注入的两个脚本（`content.js` → `setupMuxInPage()`）：

- `lib/mp4-remux.iife.js` → 全局 `window.mp4Remux`
- `lib/m4s-mux.js` → 全局 `window.BiliM4sMux.mergeM4s()`

**不要用 FFmpeg.wasm**：B 站页面无 `SharedArrayBuffer`，且 CSP 限制多。

---

## 5. B 站 API 参考

| 接口 | 用途 |
|------|------|
| `GET /x/web-interface/view?bvid=` | 视频信息、分 P、cid |
| `GET /x/player/playurl?avid=&cid=&qn=&fnval=` | 播放地址 |

**fnval 含义：**

| fnval | 格式 | 适用 |
|-------|------|------|
| `1` | durl 单文件（音视频合一） | ≤720P |
| `16` | DASH 分轨（m4s） | 高清 |

**请求头：** `Referer: https://www.bilibili.com/`，`credentials: 'include'`

无需 WBI 签名（旧版 playurl 接口）。

---

## 6. 修改指南（常见任务）

### 改版本号

1. `manifest.json` → `"version"`
2. 其他文件通过 `chrome.runtime.getManifest().version` 读取，**无需手改**

### 增加 CDN 镜像

编辑 `content/page-agent.js` → `MIRRORS` 数组。

### 调整清晰度过滤规则

编辑 `getQualities()` 中 `inDash` / `viaDurl` 判断逻辑。

### 改 UI 样式

编辑 `content/content.css`，面板根节点 `#bili-dl-panel`。

### 支持新页面类型

1. `manifest.json` → `content_scripts.matches` 增加 URL 模式
2. `parseVideoId()` 增加 URL 解析规则

### 合并失败

1. 确认 `window.mp4Remux` 和 `window.BiliM4sMux` 已加载（F12 → 页面上下文 Console）
2. 运行 `cd test && npm run test:merge` 验证 mp4-remux 本身是否正常
3. 检查音频是否来自 `backupUrl`（upos），非 mcdn

### 下载 403

1. 必须在 **MAIN world** fetch，不要改回 background fetch
2. 先播放几秒再下载（嗅探 `performance.getEntriesByType('resource')`）
3. 加镜像节点或检查 `isDownloadableCdnUrl` 过滤

---

## 7. 测试

### 自动合并测试（推荐，无需浏览器）

```bash
cd test
npm install          # 首次
npm run test:merge   # 默认 BV13CT66DEE5
node test_merge_auto.mjs BV1xxxxxx   # 指定 BV
```

输出 `test/_out/merged.mp4` 即为合并结果。

### 浏览器手动测试

1. `chrome://extensions` → 加载已解压扩展
2. 打开 B 站视频页 → **F5 刷新**
3. 右下角粉色按钮 → 选清晰度 → 下载
4. 看面板「调试日志」

### 打发布包

```bash
python scripts/pack.py
# 生成 bilibili-downloader.zip
```

---

## 8. 已知问题与注意事项

### 技术限制

| 问题 | 原因 | 处理 |
|------|------|------|
| 扩展后台 fetch CDN 403 | 防盗链 | 必须用 page-agent MAIN world |
| 假 1080P 选项 | support_formats ≠ dash.video | 已过滤，显示源最高清晰度 |
| mcdn 音频 0 字节 | P2P 节点不可直接 fetch | 用 backupUrl 的 upos 地址 |
| chrome.downloads 不可用 | content script 无此 API | 用 `<a download>` 保存 |
| 内联脚本被 CSP 拦截 | B 站 CSP | 只用外链 `chrome-extension://` 脚本 |
| 大文件内存占用 | 全内存下载+合并 | >1.5GB 会拒绝，建议低清 |

### 合规

- 仅供个人学习，遵守 B 站用户协议与版权法
- 上架 Chrome/Edge 商店**极易被拒**（视频下载类）
- 不要写「破解」「绕过会员」等描述

### 维护注意

- `page-agent.js` 与 `content.js` 的 `PANEL`/`AGENT` 必须同步
- 注入到页面的脚本必须用 **外链**（`chrome.runtime.getURL`），禁止内联
- `web_accessible_resources` 必须包含 `lib/mp4-remux.iife.js` 和 `lib/m4s-mux.js`
- 修改 `page-agent.js` 后用户需 **F5 刷新**页面（document_start 注入）
- 修改 `content.js` / `manifest.json` 后需 **重新加载扩展**

---

## 9. 版本演进简史

| 版本 | 方案 |
|------|------|
| v1.x | 扩展后台 + WBI 签名 fetch CDN → 403 |
| v2.0 | MAIN world 页面抓取 + CDN 镜像 |
| v2.1 | FFmpeg.wasm 合并 → SharedArrayBuffer / CSP 失败 |
| v2.2 | **mp4-remux 纯 JS 合并**（当前稳定方案） |

---

## 10. 依赖说明

| 文件 | 来源 | 许可 |
|------|------|------|
| `lib/mp4-remux.iife.js` | [mscststs/mp4-remux](https://github.com/mscststs/mp4-remux) | MIT |
| `lib/m4s-mux.js` | 本项目封装 | — |

更新 mp4-remux：

```bash
cp test/node_modules/mp4-remux/lib/mp4-remux.iife.js lib/
```

---

## 11. START_DOWNLOAD 返回值

```javascript
// 低清 durl：page-agent 直接 saveBlob，content 收到：
{ dash: false }

// 高清合并成功：content 负责 saveBlob
{ merged: true, filename: '标题.mp4', mp4: ArrayBuffer }

// 高清无音频：page-agent 保存 video.m4s
{ dash: true, videoOnly: true }
```

---

## 12. 快速定位代码

| 想改… | 文件 | 函数 |
|--------|------|------|
| 下载逻辑 | `page-agent.js` | `handleDownload`, `pageDownload` |
| CDN 镜像 | `page-agent.js` | `MIRRORS`, `rewriteCdnUrl`, `pickWorkingUrl` |
| 清晰度列表 | `page-agent.js` | `getQualities` |
| 合并 | `page-agent.js` + `lib/m4s-mux.js` | `mergeM4sInPage` |
| UI 面板 | `content.js` + `content.css` | `mountUI` |
| 通信超时 | `content.js` | `agentCall`（默认 600000ms） |
| 权限/匹配页 | `manifest.json` | — |

---

*文档与代码同步至 v2.2.1。后续改架构请更新本文档对应章节。*
