# Chrome Web Store 上架填写参考（v1.0.2）

> Extension ID（草稿）：`dplkepecnmdileeogcflfbjcoonkfaom`  
> 打包：项目根目录运行 `python scripts/pack.py` → `bilibili-downloader.zip`  
> Edge 对照文档：`store/EDGE_SUBMIT.md`

## 提交前清单

```text
□ 上传 bilibili-downloader.zip（version = 1.0.2）
□ 商品详情：说明 / 类别 / 图片资源
□ 隐私权：单一用途、权限理由、远程代码=否、不收集数据、隐私政策 URL
□ 分发：免费；公开；地区仅「中国」（不要「所有地区」）
□ 测试说明：用户名密码留空；「其他说明」粘贴本文英文
□ 提请审核
```

---

## 1. 商品详情

### 类别

效率（没有则选「工具」）

### 说明（中文）

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

### 其他字段

| 字段 | 填什么 |
|------|--------|
| 官方网址 | **无**（未做 Search Console 验证则不要选） |
| 首页网址 | `https://snowflake-hangdudu.github.io/bili-downloader/` |
| 支持信息页面网址 | `https://snowflake-hangdudu.github.io/bili-downloader/faq.html` |
| 成人内容 | **关** |

### 图片资源（`store/`）

| Chrome 项 | 文件 |
|-----------|------|
| 商店图标 128×128 | `store/store-icon-128.png`（或 `icons/icon128.png`） |
| 屏幕截图 1280×800 | `store/screenshot-1280x800.png` |
| 小型宣传图块 440×280 | `store/tile-440x280.png` |
| 顶部宣传图块 1400×560 | `store/marquee-1400x560.png` |
| 宣传视频 YouTube | **可不填** |

截图样例来源视频：https://www.bilibili.com/video/BV1HfW2epEPi

> 注意：manifest / `_locales/en` 的 Description ≤ **132** 字符较稳妥（Chrome/Edge 对短描述有长度限制，英文尤易超限）。

---

## 2. 隐私权

### 单一用途说明

```
帮助用户在哔哩哔哩（bilibili.com）普通视频页，将本人有权观看的视频保存为 MP4，或将音频保存为 M4A，供个人学习使用。扩展仅在用户主动点击下载时工作，不破解会员、不绕过付费内容。
```

### 需请求 activeTab 的理由

```
仅在用户当前打开的 B 站视频标签页中运行，用于识别视频信息与触发下载面板，不会在无关标签页中运行。
```

### 需请求 scripting 的理由

```
向当前 B 站视频页注入必要脚本，以读取视频元数据并在页面内完成下载与音视频合并（Manifest V3 要求）。
```

### 需请求 storage 的理由

```
仅在本地保存用户的下载历史记录与悬浮按钮位置，不上传任何数据。
```

### 需请求主机权限的理由

```
访问 bilibili.com 视频页与官方接口，获取标题、清晰度等公开信息；访问 bilivideo.com / bilivideo.cn CDN，下载用户选择的视频/音频流。仅用于用户主动发起的下载，不收集用户数据。
```

### 远程代码

选：**否**（未使用远程代码）

### 数据收集

- 所有数据类型：**全部不勾选**
- 底部三条确认声明：**全部勾选**

### 隐私权政策网址

```
https://snowflake-hangdudu.github.io/bili-downloader/
```

---

## 3. 分发

| 项 | 建议 |
|----|------|
| 付款 | 免费 |
| 公开范围 | 公开 |
| 地区 | **仅中国**（取消「所有地区」） |

---

## 4. 测试说明（访问权限）

| 字段 | 填什么 |
|------|--------|
| 用户名 | **留空**（公开样例 720P 无需登录） |
| 密码 | **留空** |
| 其他说明 | 粘贴下面英文（≤500 字符） |

```
IMPORTANT: Works ONLY on bilibili.com /video/BV... or /video/av... pages (NOT homepage/search/bangumi).

Test steps:
1) Open https://www.bilibili.com/video/BV1GJ411x7h7 (public; no login needed for 360P/720P)
2) Wait for full load. Click the round FAB at bottom-right (or toolbar icon → 打开下载面板)
3) Select 720P or lower → 开始下载
4) Expected: progress bar, then an MP4 is saved

Network: bilibili.com is mainly reachable from mainland China. Markets set to China. If page fails outside China, please retest on a China-accessible network.

No remote code; no user data collected. Does NOT unlock VIP/paid content. Contact: hangdudu0@agent.qq.com
```

保存更改 → **提请审核**。

---

## 若被拒（主功能测不了）

优先检查：地区是否仅中国、测试说明是否已填、是否误测首页。  
拒审后可按本文重贴测试说明与隐私政策，不必先改代码。
