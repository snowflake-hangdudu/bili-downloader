# B站视频下载助手 — 开发者文档

> **版本：1.2.0** | Manifest V3 | 更新：2026-07-13  
> **新开会话请先通读本文 + `manifest.json`。** 读完应能改 bug、加功能、打包、更新商店。

---

## 0. 新会话 30 秒上手

```text
项目路径    d:\插件\bilibili-downloader  （GitHub: snowflake-hangdudu/bili-downloader）
定位        面向国内用户，B 站视频页保存 MP4，完全免费
核心约束    下载必须在页面 MAIN world；不破解会员/付费；不收集用户数据
双入口 UI   右下角悬浮面板（主操作） + 右上角 popup（信息 + 打开面板）
改 UI       content.js / content.css（面板）  popup/*（工具栏弹窗）
改下载逻辑   content/page-agent.js
改版本      manifest.json → version；改 _locales 若改名称描述
打包        python scripts/pack.py  →  bilibili-downloader.zip
本地调试    edge://extensions 加载已解压 → B 站视频页 F5
```

**改代码后生效：**

| 改了什么 | 用户操作 |
|----------|----------|
| `page-agent.js` | F5 刷新 B 站页 |
| `content.js` / `content.css` / `manifest.json` / `popup/*` | 重新加载扩展 + F5 |
| `_locales/*` | 重新加载扩展；商店需重传 zip |

---

## 1. 产品决策（勿随意推翻）

| 决策 | 说明 |
|------|------|
| 目标用户 | **优先中国人**，界面全中文，`default_locale: zh_CN` |
| 收费 | **v1.0 全免费**，无内购/激活码 |
| 功能范围 | **仅普通视频页 MP4**（`/video/BV|av`），**不支持番剧页**；无「仅音频」、无设置/历史/输出页 |
| 下载 UI | **展示进度条**（真实百分比 + 阶段文字）；支持**暂停/继续/取消**；合并阶段隐藏暂停 |
| 清晰度 | 以 API 返回为准，**过滤虚假 1080P/4K**；低清 durl 接受 `*.bilivideo.com/cn` CDN |
| 反馈 | QQ `748604487`，`tencent://` + 复制号码 |
| 合规 | 个人学习；不绕过会员/付费番剧；不上传数据 |

---

## 2. 外部链接

| 用途 | URL |
|------|-----|
| GitHub 仓库 | https://github.com/snowflake-hangdudu/bili-downloader |
| 隐私政策（Pages） | https://snowflake-hangdudu.github.io/bili-downloader/ |
| 常见问题 FAQ（Pages） | https://snowflake-hangdudu.github.io/bili-downloader/faq.html |
| Edge 开发者 | https://partner.microsoft.com/dashboard |
| Edge 上架说明 | 见 `store/EDGE_SUBMIT.md` |
| GitHub Pages 说明 | 见 `store/GITHUB_PAGES.md` |

**Edge 商店状态（2026-07-13）：** 已提交 v1.0.0，**In review**。Store ID `0RDCKF6C35QD`。通过后 Overview 会有商店 URL。

---

## 3. 项目结构

```
bilibili-downloader/
├── manifest.json              # 版本、权限、content_scripts、i18n 入口
├── background.js              # Service Worker，仅安装日志
├── _locales/
│   ├── zh_CN/messages.json    # 扩展名/描述（中文，default_locale）
│   └── en/messages.json       # 扩展名/描述（英文，Edge 商店用）
├── content/
│   ├── page-agent.js          # ★ MAIN world：API、CDN、合并、下载
│   ├── content.js             # ★ ISOLATED world：悬浮 UI、postMessage、popup 通信
│   └── content.css            # 悬浮面板样式（深蓝灰主题）
├── popup/
│   ├── popup.html/js/css      # 工具栏弹窗：视频信息、打开面板、QQ 反馈
├── lib/
│   ├── mp4-remux.iife.js      # 第三方 DASH 合并（MIT）
│   └── m4s-mux.js             # 封装 mergeM4s
├── icons/                     # 16/32/48/128（gen_icons.py 生成）
├── assets/icon-source.png     # 图标源图 1024×1024
├── docs/index.html            # GitHub Pages 隐私政策（与 store/privacy.html 同步）
├── docs/faq.html              # GitHub Pages 常见问题（与 store/faq.html 同步）
├── store/
│   ├── privacy.html           # 隐私政策源文件
│   ├── faq.html               # 常见问题源文件
│   ├── logo-300.png           # Edge 商店 Logo
│   ├── tile-440x280.png       # Edge 推广图
│   ├── EDGE_SUBMIT.md         # Edge 表单文案
│   └── GITHUB_PAGES.md
├── scripts/
│   ├── pack.py                # 打 zip（仅扩展运行文件）
│   ├── gen_icons.py           # 从 icon-source 生成 icons/*
│   └── gen_store_assets.py    # 生成 store/logo、tile
├── test/                      # 本地测试（不打进 zip）
└── bilibili-downloader.zip    # pack.py 输出，上传 Edge 用
```

### 勿恢复的旧文件

`lib/bili-api.js`、`lib/wbi.js`、`lib/ffmpeg/*`、`content/bili-api.js` — v1 已废弃。

---

## 4. 架构

### 4.1 为何双 World

B 站 CDN 对扩展后台 `fetch` 返回 **403**。必须在 **MAIN world** 与播放器共享 Cookie/Referer。

```
B 站页面
┌─────────────────────┐   postMessage    ┌──────────────────┐
│ page-agent.js       │ ◄──────────────► │ content.js       │
│ (MAIN)              │  bili-dl-panel   │ (ISOLATED)       │
│ · B 站 API          │  bili-dl-agent   │ · 悬浮 UI        │
│ · CDN 下载          │                  │ · chrome.runtime │
│ · mp4-remux 合并    │                  │ · <a download>   │
└─────────────────────┘                  └──────────────────┘
         ▲ 外链注入 mp4-remux.iife.js + m4s-mux.js
```

### 4.2 postMessage 协议（content ↔ page-agent）

**常量（两处必须一致）：**

```javascript
const PANEL = 'bili-dl-panel';  // content.js 发出
const AGENT = 'bili-dl-agent';  // page-agent.js 发出
```

**content → page-agent：**

| type | 参数 | 返回 data |
|------|------|-----------|
| `PARSE_URL` | `href` | `{ idInfo }` |
| `RESOLVE_VIDEO` | `href, pageIndex` | `{ info }` 见下 |
| `GET_QUALITIES` | `aid, cid` | `{ qualities[], maxQn, maxLabel, loginHint? }` |
| `GET_ESTIMATE` | `aid, cid, qn, duration` | `{ sizeBytes, sizeLabel, estimateNote? }` |
| `START_DOWNLOAD` | `aid, cid, qn, title` | 见 §11 |
| `PAUSE_DOWNLOAD` | — | 无返回；中断当前 fetch，保留已下载字节 |
| `RESUME_DOWNLOAD` | — | 无返回；`Range` 断点续传 |
| `CANCEL_DOWNLOAD` | — | 无返回；中止下载并重置控制状态 |

**`RESOLVE_VIDEO` 的 info 字段：**

```javascript
{ bvid, aid, cid, title, pages, pic, author, view, pubdate, duration }
```

**page-agent → content：** `OK` / `ERR`（带 `id`）、`LOG`、`PROGRESS`

**`PROGRESS` 字段：**

```javascript
{ step, percent, received?, total? }
// step: prepare | download | video | audio | merge | save | paused | queue
```

content.js 的 `updateProgress()` 据此更新进度条；`agentSignal(type)` 用于暂停/继续/取消（无 id、无 Promise）。

**content 调用封装：** `agentCall(type, payload)`，超时 600000ms。

### 4.3 popup ↔ content（chrome.runtime.onMessage）

定义在 `content.js` 末尾，依赖 `window.__BILI_DL_API__`：

| type | 作用 |
|------|------|
| `BILI_DL_GET_INFO` | 返回 `fetchSnapshot()`，供 popup 展示 |
| `BILI_DL_OPEN_PANEL` | 打开悬浮面板并 `loadVideoInfo()` |

`fetchSnapshot()` = `RESOLVE_VIDEO` + `GET_QUALITIES`，不下载。

---

## 5. UI 说明

### 5.1 右下角悬浮面板（主入口）

- 文件：`content.js` + `content.css`
- FAB 按钮 64×64，图标 `icons/icon128.png`
- 面板宽 400px：**识别条** → **视频卡片** → **分 P 列表** → **清晰度胶囊** → 预计大小 / 登录提示 → 格式 MP4 → 开始下载 / **队列下载全部分 P**
- **下载进度区**（下载时显示）：视频名、清晰度标签、阶段文字、百分比、进度条；下方「暂停」「取消」（合并阶段隐藏暂停）
- 底栏：`常见问题`（FAQ Pages）+ QQ 反馈
- 失败 status 带「查看常见问题」链接（锚点：`#cdn-403` 等）
- 成功/失败：简短 status 条

### 5.2 右上角 popup（信息入口）

- 文件：`popup.html` / `popup.js` / `popup.css`
- **B 站视频页**：展示封面、标题、UP、可用清晰度标签、「打开下载面板」
- **非视频页**：三步引导 + 当前页面地址 +「前往 B 站」按钮
- **加载/通信失败**：错误提示 +「刷新并重试」
- 底栏 QQ 反馈（同面板）

**分工：** popup 看信息 + 跳转面板；**实际下载只在面板操作**。

---

## 6. 核心流程

### 6.1 打开面板

`toggleBtn` → `loadVideoInfo()` → `fetchSnapshot()` → 渲染 UI（加载中显示骨架屏）

### 6.2 清晰度 `getQualities()`（page-agent.js）

请求：`/x/player/playurl?qn=80&fnval=16&fourk=1`

- 从 `dash.video` 收集真实 `id`（qn）
- 每项：`inDash` 或 `qn<=64`（durl）才展示
- 默认选中最高 qn

### 6.3 下载 `handleDownload()`

```
qn <= 64  → 优先 fnval=1 durl（extractDurlUrls 含 backup_url）
            → 失败回退 DASH → 单文件 .mp4 → page-agent saveBlob
qn > 64   → fnval=16 DASH → 下视频轨 + 音频轨 → mergeM4sInPage
            → 返回 ArrayBuffer → content.js <a download> 保存
```

**暂停/继续：** `dlCtrl` + `AbortController`；暂停时 abort 当前 fetch，记录 `lastProgress`；继续时用 `Range: bytes=N-` 断点续传。DASH 高清时音视频**后台并行下载**，进度 UI **先视频流、后音频流**分阶段展示；暂停/取消作用于全部轨。

**CDN 探测（v1.0.1+）：** 嗅探节点 → 会话缓存镜像 → 每批 3 个并行探测（超时 4s）；成功镜像写入 `sessionMirrorCache`。

**取消：** 设置 `dlCtrl.cancelled`，abort 并抛出「下载已取消」。

### 6.4 CDN `pageDownload()`

1. `extractStreamUrls()` / `extractDurlUrls()`：`url` + `backup_url`，跳过 mcdn
2. `isDownloadableCdnUrl()`：接受 `*.bilivideo.com/cn`（低清 durl），拒绝 mcdn / estgoss 等
3. `pickWorkingUrl()`：Range 探测 + `MIRRORS` 镜像替换
4. `fetch`，`Referer: https://www.bilibili.com/`，`credentials: 'include'`
5. 失败时先播放几秒（`sniffPlayingUrls()` 嗅探 performance 资源）

### 6.5 合并

- 注入 `lib/mp4-remux.iife.js`、`lib/m4s-mux.js`（**必须外链**，禁止内联）
- `window.BiliM4sMux.mergeM4s()` + `window.mp4Remux`
- 总大小 >1.5GB 拒绝
- **禁止 FFmpeg.wasm**（无 SharedArrayBuffer）

---

## 7. B 站 API

| 接口 | 用途 |
|------|------|
| `GET /x/web-interface/view?bvid=` | 标题、分 P、cid、pic、owner.name、stat、pubdate |
| `GET /x/player/playurl?avid=&cid=&qn=&fnval=` | 播放地址 |

| fnval | 格式 | 适用 |
|-------|------|------|
| `1` | durl 单文件 | ≤720P |
| `16` | DASH m4s | 高清 |

无需 WBI。请求头：`Referer: https://www.bilibili.com/`，`credentials: 'include'`。

---

## 8. 国际化

`manifest.json`：

```json
"default_locale": "zh_CN",
"name": "__MSG_extName__",
"description": "__MSG_extDesc__"
```

| 文件 | 用途 |
|------|------|
| `_locales/zh_CN/messages.json` | 中文扩展名/描述 |
| `_locales/en/messages.json` | 英文（Edge 商店 English listing） |

改名称/描述：**改 `_locales` + 重传 zip**，不要硬编码回 manifest。

---

## 9. 常见修改

| 任务 | 位置 |
|------|------|
| 改版本 | `manifest.json` → `version` |
| 改扩展名/描述 | `_locales/zh_CN`、`en` |
| 下载/CDN/清晰度 | `page-agent.js` |
| 悬浮 UI | `content.js` + `content.css` |
| popup UI | `popup/*` |
| CDN 镜像 | `page-agent.js` → `MIRRORS` |
| 新页面类型 | `manifest.json` matches + `parseVideoId()`（仅 `BV`/`av`，不含番剧） |
| 反馈 QQ | `content.js` 底栏、`popup.html`、`docs/index.html` |
| 图标 | 换 `assets/icon-source.png` → `python scripts/gen_icons.py` |
| 商店图 | `python scripts/gen_store_assets.py` |

### 改 UI 主题

CSS 变量在 `content/content.css` 顶部 `--bdl-*`（主色 `#2563eb`，标题栏 `#0f172a`）。

### 加 popup 功能

经 `chrome.tabs.sendMessage` 扩展 `__BILI_DL_API__`，勿在 popup 里直接 fetch CDN。

---

## 10. 测试

```bash
# 合并链路（无需浏览器）
cd test && npm install
npm run test:merge
node test_merge_auto.mjs BV1xxxxxx

# 浏览器
edge://extensions → 开发者模式 → 加载已解压 → bilibili-downloader 目录
打开 https://www.bilibili.com/video/BV1GJ411x7h7 → F5 → 右下角按钮
```

---

## 11. START_DOWNLOAD 返回值

```javascript
{ dash: false }                                    // 低清，page-agent 已 saveBlob
{ merged: true, filename: '标题.mp4', blob: Blob } // 高清，content saveBlob（优先 blob，兼容 mp4 ArrayBuffer）
{ dash: true, videoOnly: true }                    // 无音频，仅 video.m4s
```

---

## 12. 打包与发布

```bash
python scripts/pack.py          # → bilibili-downloader.zip（根目录含 manifest.json）
python scripts/gen_icons.py     # 可选，更新 icons
python scripts/gen_store_assets.py
```

**zip 结构要求：** `manifest.json` 在 zip **根目录**，不要多包一层文件夹。

**Edge 更新已上架扩展：** Partner Center → Update → 上传新 zip（version 必须递增）→ 重新提交审核。

**隐私政策变更：** 同步改 `docs/index.html` 与 `store/privacy.html`，`git push`，Pages 自动更新。

---

## 13. 已知问题

| 问题 | 处理 |
|------|------|
| 后台 fetch CDN 403 | 勿改回 background 下载 |
| 假 1080P | 已过滤，以 dash.video 为准 |
| 360P/480P「无有效 CDN」 | `isDownloadableCdnUrl` 已接受 `cn-*.bilivideo.com`；`extractDurlUrls` 含 backup |
| mcdn 音频 0 字节 | 用 backupUrl upos |
| 下载 403 | 先播放几秒；加镜像 |
| 大文件 OOM | >1.5GB 拒绝，提示低清 |
| Edge 上传 correlationId undefined | 换 Edge 浏览器重传；用 pack.py 的 zip |
| 商店 Add language 灰色 | manifest 缺 `_locales`，已修复 |

---

## 14. 代码速查

| 想改… | 文件 | 符号 |
|--------|------|------|
| 下载 | `page-agent.js` | `handleDownload`, `pageDownload`, `getStreams` |
| 暂停/取消 | `page-agent.js`, `content.js` | `dlCtrl`, `pauseDownloadControl`, `agentSignal` |
| CDN | `page-agent.js` | `MIRRORS`, `sessionMirrorCache`, `pickWorkingUrl`, `PROBE_PARALLEL` |
| 清晰度 | `page-agent.js` | `getQualities` |
| 合并 | `page-agent.js`, `lib/m4s-mux.js` | `mergeM4sInPage` |
| 面板 UI | `content.js`, `content.css` | `mountUI`, `loadVideoInfo`, `updateProgress`, `startDownload` |
| popup | `popup.js` | `init`, `renderVideo`, `showEmptyState` |
| popup↔面板 | `content.js` | `__BILI_DL_API__`, `onMessage` |
| 权限/匹配 | `manifest.json` | — |
| 合并库预加载 | `content.js` | `setupMuxInPage`, `muxReadyPromise` |
| 错误引导 | `page-agent.js` | `formatDownloadError` |
| 分 P 队列 | `content.js` | `startQueueDownload`, `runSingleDownload` |
| 下载预估 | `page-agent.js`, `content.js` | `estimateDownloadSize`, `GET_ESTIMATE`, `refreshEstimate` |
| 登录提示 | `page-agent.js` | `buildLoginHint`, `isLoggedIn` |
| 打包列表 | `scripts/pack.py` | `INCLUDE` |

---

## 15. 版本史

| 版本 | 说明 |
|------|------|
| v1.2.0 | 分 P 队列下载；下载预估体积；登录/清晰度提示；FAQ 页 + 失败场景引导链接 |
| v1.0.1 | DASH 音视频并行下载；CDN 并行探测 + 会话镜像缓存；合并库链式预加载；下载失败友好引导；高清合并结果以 Blob 传递 |
| v1.0.0 | 正式版：双入口 UI、i18n、Edge 提交、QQ 反馈、mp4-remux 合并 |
| v1.0.0+（内部迭代） | 进度条、暂停/继续/取消、低清 CDN 修复、加载骨架屏、popup 非视频页引导；**无**下载历史、**无**番剧页、**无** Tab 详情页 |
| v2.x（内部迭代） | MAIN world + CDN 镜像 + 去 FFmpeg |
| v1.x（已废弃） | 后台 WBI fetch → 403 |

---

## 16. 依赖

| 文件 | 来源 |
|------|------|
| `lib/mp4-remux.iife.js` | [mscststs/mp4-remux](https://github.com/mscststs/mp4-remux) MIT |

更新：`cp test/node_modules/mp4-remux/lib/mp4-remux.iife.js lib/`

---

## 17. 新会话推荐第一句话

```text
请先阅读 DEVELOPER.md 和 manifest.json，然后在 bilibili-downloader 项目上执行：<你的需求>
```

---

## 18. v1.3 计划（未实现，仅文档）

> v1.2 已实现：分 P 队列、下载预估、登录提示、FAQ。以下为后续项。

| 优先级 | 项 | 说明 | 涉及文件 |
|--------|-----|------|----------|
| 中 | SPA 路由监听 | 用 `pushState`/`popstate` hook 替代 `setInterval` 轮询 URL | `content.js` |
| 中 | 进度细化 | 合并阶段显示 MB 数；下载阶段 `已下/总量`；可选 ETA | `content.js` |
| 低 | `chrome.downloads` | 可选保存路径、浏览器下载管理器集成（需 `downloads` 权限） | `manifest.json`, `content.js` |
| 低 | FAB 可拖拽 | 避免遮挡播放器控件 | `content.js`, `content.css` |
| 低 | 键盘快捷键 | 如 `Alt+D` 打开面板 | `content.js` |
| 低 | 远程镜像配置 | GitHub raw 更新 `MIRRORS`，免发版 | `page-agent.js`, `background.js` |
| 低 | 单元测试扩展 | mock fetch 测 `getQualities`、CDN 过滤 | `test/` |
| 低 | popup 选分 P | 「打开面板」时传递 `pageIndex` | `popup.js`, `content.js` |
| 低 | 工具函数抽取 | `formatView`/`formatTime` 抽到 `lib/format.js` | `lib/`, `content.js`, `popup.js` |
| 低 | 文件名截断 | 按字符数截断，避免中文乱码 | `page-agent.js` |

---

*文档与代码同步至 v1.2.0（2026-07-13）。改架构或产品决策请更新本文对应章节。*
