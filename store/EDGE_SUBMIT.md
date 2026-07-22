# Microsoft Edge 上架填写参考（v1.0.0）

> **商店状态（2026-07-23）：** v1.0.0 首次审核未通过（政策 **1.1.3**，主功能无法测试）。  
> Product ID：`f2db821e-8942-4cc6-99d1-509775796785`。未上线前 version 保持 **1.0.0**。  
> **视觉：** 整体深色主题 + 图标迭代 3.0（蓝断环 TV + 粉播放/下载）。重提时重新 `pack.py` 即可，不必升 version。

## 本次重提（按序做）

```text
1. 本机验通
   edge://extensions → 重新加载 → 打开
   https://www.bilibili.com/video/BV1GJ411x7h7 → F5
   右下角按钮 → 720P → 下载成功

2. 打包（项目根目录）
   python scripts/pack.py
   → 得到 bilibili-downloader.zip
   （确认 zip 根目录有 manifest.json，version = 1.0.0）

3. Partner Center
   https://partner.microsoft.com/dashboard → 该扩展
   · Markets：优先仅「中国」
   · Store listing：可用本文第五步描述（强调仅 /video 页、右下角入口）
   · Notes for Certification：粘贴本文第七步英文全文（必填）
   · 上传刚打的 zip → Submit
```

审核备注与拒审说明见下文第七步、文末「若被拒 / 重提清单」。

## 提交包

路径：`bilibili-downloader.zip`（运行 `python scripts/pack.py` 生成）

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

### Description（详细描述）

```
B站视频下载助手帮助您在哔哩哔哩（bilibili.com）普通视频页保存视频为 MP4。面向中国用户；请在可访问 bilibili.com 的网络环境下使用。

重要：仅在视频页生效（地址含 /video/BV… 或 /video/av…）。首页、搜索页、番剧页没有下载按钮。主入口为页面右下角圆形悬浮按钮。

主要功能：
• 自动识别当前 B 站视频页，显示标题、UP 主、可用清晰度
• 支持 360P～1080P 等真实可下载清晰度（以视频源为准）
• 高清视频自动合并音视频，输出 MP4
• 下载进度条显示真实进度，支持暂停与取消
• 右下角悬浮面板 + 工具栏 popup，一键下载
• 完全免费，不收集任何用户数据

使用说明：
1. 打开 bilibili.com 任意普通视频页（例如 https://www.bilibili.com/video/BV1GJ411x7h7）
2. 点击页面右下角悬浮按钮（或浏览器工具栏图标 → 打开下载面板）
3. 选择清晰度（建议先试 720P 或更低）→ 开始下载（可暂停/取消）
4. 若下载失败，请先播放视频 2～3 秒再重试

重要说明：
• 仅供个人学习与研究，请遵守 B 站用户协议与著作权法
• 不破解大会员、不绕过付费番剧
• 登录 B 站账号可获得更高清晰度
• 不支持合集批量；多分 P 视频可在面板内队列下载

反馈 QQ：748604487
常见问题：https://snowflake-hangdudu.github.io/bili-downloader/faq.html
```

### Search terms（搜索词，可选）

```
bilibili, B站, 视频, 下载, MP4, 哔哩哔哩
```

---

## 第六步：商店图片

| 素材 | 尺寸 | 文件 |
|------|------|------|
| Extension logo | 300×300（最小 128） | `store/logo-300.png` |
| Small promotional tile | 440×280 | `store/tile-440x280.png` |
| Screenshots | 1280×800 或 640×480 | **需自行截图**（见下） |

### 截图建议（至少 1 张，建议 3 张）

1. B 站视频页 + 右下角下载面板（含进度条与暂停按钮）— **必须能看清右下角入口**
2. 浏览器工具栏 popup 显示视频信息
3. 清晰度选择与「开始下载」按钮

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
- Publisher contact (China): QQ 748604487

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
4. `python scripts/pack.py` → 确认 zip 根目录有 `manifest.json`，version 仍为 `1.0.0`

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
| 想降低「测错页」概率 | 可选优化非视频页 popup 文案（低优先级） |
