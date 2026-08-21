# Microsoft Edge 上架填写参考（v1.0.2）

> **商店状态（2026-08-02）：** 准备提交 **v1.0.2**（并行下载 + 独立进度卡 + 拖拽修复等）。  
> Product ID：`f2db821e-8942-4cc6-99d1-509775796785` · Store ID：`0RDCKF6C35QD`  
> 直链：https://microsoftedge.microsoft.com/addons/detail/fdcimmiafpnpkehegehnjjkllogfjmem  

## 本次发版 1.0.2（按序做）

```text
1. 本机验通
   edge://extensions → 重新加载 → 打开
   https://www.bilibili.com/video/BV1GJ411x7h7 → F5
   右下角按钮 → 720P → 下载成功
   （可选）再下一个并行任务，确认两张进度卡可单独取消
   （可选）多 P 视频：队列下载 →「取消整队」
   （可选）非视频页点扩展图标：应看到「仅支持 /video」提示

2. 打包（项目根目录）
   python scripts/pack.py
   → bilibili-downloader.zip
   （确认 zip 根目录有 manifest.json，version = 1.0.2）

3. Partner Center → Update（发版收尾清单）
   https://partner.microsoft.com/dashboard → 该扩展
   □ 上传 bilibili-downloader.zip
   □ Markets：仅「中国」（不要 Worldwide）
   □ Store listings 中文：
       - Description：粘贴本文第五步中文
       - Search terms：B站下载, bilibili下载, 哔哩哔哩, 视频下载, MP4, M4A, BV下载, 分P下载
       - 更新说明 / What's new：粘贴「1.0.2 更新说明」中文
   □ Store listings English（若已添加）：
       - Description / Search terms / What's new：见第五步英文
   □ 商店图片：logo / tile / 至少 1 张 1280×800 截图（见第六步）
   □ Notes for Certification：粘贴第七步英文全文（勿留空）
   □ Submit
```

审核备注与拒审说明见下文第七步、文末「若被拒 / 重提清单」。

## 提交包

路径：`bilibili-downloader.zip`（运行 `python scripts/pack.py` 生成）

> **注意：** Edge 校验 manifest / `_locales/*/messages.json` 的 **Description ≤ 190 字符**（英文 `extDesc` 尤易超限）。超出会报 `Package Validation Errors`。

---

## 第一步：注册开发者

1. 打开 https://partner.microsoft.com/dashboard
2. 用 Microsoft 账号（Outlook / Hotmail）登录
3. 注册 **Microsoft Edge 扩展** 开发者（个人账号，免费）
4. 首页 Workspaces → **Edge** → **Create new extension**

---

## 第二步：上传 zip

拖拽 `bilibili-downloader.zip` 到上传区，等待验证通过。

---

## 第三步：Availability（可用性）

| 项 | 建议 |
|----|------|
| Visibility | Public（公开） |
| Markets | **优先仅选「中国」**（审核需能打开 bilibili.com；Worldwide 易因海外网络测不通被拒） |

---

## 第四步：Privacy（隐私）— 复制粘贴用

### Single Purpose（单一用途）

```
帮助用户在哔哩哔哩（bilibili.com）视频页面，将本人有权观看的视频保存为 MP4 文件，供个人学习使用。扩展仅在用户主动点击下载时工作，不破解会员、不绕过付费内容。
```

### Permission justification（权限说明）

**activeTab**
```
仅在用户当前打开的 B 站视频标签页中运行，用于识别视频信息与触发下载。
```

**scripting**
```
向当前 B 站视频页注入必要脚本，以读取视频元数据并在页面内完成下载（Manifest V3 要求）。
```

**storage**
```
仅在本地保存用户的下载历史记录与悬浮按钮位置，不上传任何数据。
```

**https://*.bilibili.com/***
```
访问 B 站视频页面与官方 API，获取视频标题、清晰度等公开信息。
```

**https://*.bilivideo.com/* 与 https://*.bilivideo.cn/***
```
从 B 站 CDN 下载用户选择的视频/音频流文件。
```

### Remote code（远程代码）

选择：**No, I am not using remote code**

### Data usage（数据收集）

- 全部 **不勾选**（不收集任何用户数据）
- 认证勾选：数据不出售、不用于无关目的等（按表单默认合规项勾选）

### Privacy Policy URL（隐私政策链接）

**推荐：GitHub Pages（见 `store/GITHUB_PAGES.md`）**

```
https://snowflake-hangdudu.github.io/bili-downloader/
```

填到 Edge Partner Center 的 **Privacy Policy URL**。

---

## 第五步：Store listing（商店详情）— 中文

### Extension name（来自 manifest，上传后只读）

B站视频下载助手

### Description（详细描述）— 中文 listing

```
B站视频下载助手：在哔哩哔哩（bilibili.com）普通视频页下载 MP4 视频或 M4A 音频。面向中国用户；请在可访问 bilibili.com 的网络环境下使用。

重要：仅在 /video/BV… 或 /video/av… 视频页生效。首页、搜索页、番剧页没有下载按钮。主入口为页面右下角悬浮按钮。

主要功能：
• 识别当前视频：标题、UP 主、可用清晰度
• 真实清晰度（360P～1080P 等，以片源为准），高清自动合并为 MP4
• 可选 M4A 仅音频；多分 P / 多任务并行下载（每任务独立进度，可单独取消）
• 本地下载历史；悬浮按钮可拖拽
• 完全免费，不收集用户数据

使用说明：
1. 打开 https://www.bilibili.com/video/BV1GJ411x7h7 （或任意普通视频页）
2. 点击右下角悬浮按钮（或工具栏图标 → 打开下载面板）
3. 选清晰度（建议先试 720P）→ 开始下载
4. 若失败：先播放 2～3 秒再重试

说明：仅供个人学习；不破解会员、不绕过付费；不支持合集批量。
反馈：hangdudu0@agent.qq.com
FAQ：https://snowflake-hangdudu.github.io/bili-downloader/faq.html
```

### Search terms（中文 listing — 必填/尽量填满，便于检索）

```
B站下载, bilibili下载, 哔哩哔哩, 视频下载, MP4, M4A, BV下载, 分P下载
```

### English listing — Description（Add language: English 时粘贴）

```
Bilibili Video Download Assistant saves videos from bilibili.com /video pages as MP4 (or audio as M4A). For users who can access bilibili.com (mainly mainland China).

IMPORTANT: Works ONLY on /video/BV… or /video/av… pages. No download UI on homepage, search, or bangumi. Primary entry: floating button at the bottom-right of the video page.

Features:
• Detect title, uploader, and real available qualities
• Auto merge DASH audio/video into MP4; optional M4A audio-only
• Parallel downloads (up to 3) with separate progress cards; per-task cancel
• Multi-part (分P) parallel queue with automatic retry
• Local download history; draggable FAB
• Free; no user data collected

How to test:
1. Open https://www.bilibili.com/video/BV1GJ411x7h7
2. Click the bottom-right floating button
3. Select 720P or lower → Start download

Personal learning only. Does not unlock VIP or paid content. Does not batch-download seasons (ugc_season).
Contact: hangdudu0@agent.qq.com
FAQ: https://snowflake-hangdudu.github.io/bili-downloader/faq.html
```

### English listing — Search terms

```
bilibili, bilibili download, bilibili mp4, download bilibili video, b站, bilibili downloader, m4a
```

### 更新说明 / What's new（粘贴到 Store listings）

**位置：** Partner Center → Store listings → 中文 / English → **更新说明 / What's new** → 保存。

#### 1.0.3（本次发版 — 优先粘贴）

中文：

```
1.0.3 更新：
• 下载成功后引导商店评分（满 3 次再提示；可下次再说/不再提示）
• 面板底栏精简；非视频页与并行提示体验优化
• Firefox 打包与跨浏览器兼容（browser/chrome API）
```

英文：

```
1.0.3:
• Optional store-rating prompt after 3 successful downloads
• Cleaner panel footer; clearer non-video and parallel tips
• Firefox packaging and browser/chrome API compatibility
```

#### 1.0.2

中文：

```
1.0.2 更新：
• 支持多任务并行下载（最多 3 路），每个任务独立进度卡，可单独暂停/取消
• 分 P 队列支持「取消整队」；并行与队列互斥提示更清晰
• 修复悬浮按钮拖拽与窗口缩放后位置；下载历史支持同集 MP4 与 M4A 并列
• 非视频页 popup 明确「仅 /video」；历史「打开」自动展开下载面板
```

英文：

```
1.0.2:
• Parallel downloads (up to 3) with separate progress cards; per-task pause/cancel
• Multi-part queue: cancel entire queue; clearer parallel vs queue tips
• Fixed FAB drag + clamp on window resize; MP4/M4A history can coexist
• Non-video popup clarifies /video-only; history Open auto-opens the panel
```

#### 1.0.1（若 Live 后尚未填过，可补贴）

中文：

```
1.0.1 更新：
• 支持 M4A 仅音频下载；新增本地下载历史
• 黑白极简界面；悬浮按钮可拖拽；反馈改为邮箱
• 多分 P 队列更稳（失败自动重试）；站内切视频即时刷新
```

英文：

```
1.0.1:
• M4A audio-only download + local download history
• Minimal UI; draggable FAB; email feedback
• Multi-part queue retry; faster in-site video switch
```

---

## 第六步：商店图片

| 素材 | 尺寸 | 文件 |
|------|------|------|
| Extension logo | 300×300（最小 128） | `store/logo-300.png` |
| Small promotional tile | 440×280 | `store/tile-440x280.png` |
| Screenshots | 1280×800 或 640×480 | **需自行截图后上传 Partner Center**（见下） |

### 截图清单（至少 1 张，建议 3 张；推荐 1280×800）

在本机 Edge 加载扩展后截图，上传到 Store listings → Screenshots：

| # | 画面 | 怎么拍 |
|---|------|--------|
| 1（必拍） | 视频页 + 右下角面板展开 | 打开 BV1GJ411x7h7 → 点 FAB → 露出清晰度与「开始下载」；**右下角圆形按钮必须入镜** |
| 2 | 下载中进度卡 | 开始下载后截独立进度卡（百分比 / 暂停 / 取消）；若有并行可露两张卡 |
| 3 | 工具栏 popup | 同视频页点扩展图标：封面、标题、清晰度标签、「打开下载面板」 |

可选：非视频页 popup（「仅支持 /video」文案）— 有助于审核员理解适用范围，非必须。

> 截图文件不纳入 git（体积大）；打 zip 时也不需要放进扩展包，只上传 Partner Center。

---

## 第七步：Certification notes（审核备注）— **必填，直接粘贴**

位置：Partner Center → 提交页 → **Submission Options → Notes for Certification**  
（审核员主要看英文；下列英文块整段粘贴即可。）

```
How to test (IMPORTANT — China website):

1) This extension ONLY works on bilibili.com VIDEO pages (/video/BV... or /video/av...), NOT on the homepage, search, or bangumi pages. Content scripts do not inject on non-video pages.

2) Open this public sample video (no login required for 360P/720P):
   https://www.bilibili.com/video/BV1GJ411x7h7
   Wait until the page fully loads.

3) Network: bilibili.com is primarily accessible from mainland China. If the page is blank, times out, or blocked from your location, please retest from a China-accessible network. Markets are set for China for this reason.

4) Primary UI: look for a round floating action button (FAB) at the BOTTOM-RIGHT corner of the video page (about 64×64). Click it to open the download panel.
   Alternative: click the toolbar extension icon → button to open the download panel (“打开下载面板”).

5) In the panel: select 720P or lower → click “开始下载” (Start download).
   Optional: play the video for 2–3 seconds first if CDN download fails with 403.

6) Expected result: a progress bar appears; an MP4 file is saved. Pause / Cancel work during download (Pause is hidden during merge).

Scope / compliance:
- Manifest V3; no remote code; no user data collected.
- Local download + merge on the page only when the user clicks download.
- Does NOT unlock VIP, paid bangumi, or bypass login/payment.
- Privacy policy: https://snowflake-hangdudu.github.io/bili-downloader/
- FAQ: https://snowflake-hangdudu.github.io/bili-downloader/faq.html
- Publisher contact (China): hangdudu0@agent.qq.com

Resubmission note (2026-07): Previous review failed with 1.1.3 because primary functions were not usable. Likely cause: testing on non-video pages and/or bilibili.com unreachable outside China. Please follow steps 1–6 above.
```

中文摘要（可选，可贴在英文后）：

```
测试要点：必须打开 /video/BV 视频页（勿测首页）；右下角圆形按钮为主入口；公开样例 BV1GJ411x7h7；选 720P 下载；B 站需中国可访问网络。不破解会员、不收集数据。
```

---

## 第八步：Submit for review

检查所有必填项 → Submit → 等待审核（通常数天）

---

## 若被拒 / 重提清单（1.1.3 主功能无法测试）

**拒审原文示例：**  
`Unfortunately, we cannot test the product because the product's primary functions are not usable.`  
政策：**Technical requirement policies → 1.1.3 Distinct Function & Value: Accurate Representation**（功能可用性）。

此类拒审对「依赖国内站点」的扩展很常见，**优先补测试说明与市场设置，不一定要改代码**。

### 本机确认（重提前）

1. 无痕窗口加载已解压扩展目录  
2. 打开 `https://www.bilibili.com/video/BV1GJ411x7h7` → F5  
3. 右下角 FAB → 选 720P → 下载成功  
4. `python scripts/pack.py` → 确认 zip 根目录有 `manifest.json`，version = `1.0.2`

### Partner Center 操作

1. **Markets** → 改为 / 确认 **中国**（不要只靠 Worldwide）  
2. **Store listing** → 描述强调「仅 /video 页」「右下角入口」（见第五步）  
3. **Notes for Certification** → 粘贴第七步英文全文（不要留空）  
4. 上传新打的 `bilibili-downloader.zip` → Submit  

### 仍被同理由拒时

邮件：`ext_dev_support@microsoft.com`  
附上：Product ID、Certification Report 截图、上述测试步骤，说明依赖中国可访问的 bilibili.com。

### 何时才需要改代码

| 情况 | 动作 |
|------|------|
| 本机公开 BV 能正常下载 | 只改备注 / 市场 / listing 后重提 |
| 本机也下不了 | 再查 CDN / API（见 `DEVELOPER.md` §13） |
| 想降低「测错页」概率 | 已做：非视频页 popup 明确「仅 /video」+ 示例页入口；仍被拒则优先改备注/市场 |
