# Microsoft Edge 上架填写参考（v1.0.0）

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
| Markets | 选择「中国」+ 或 Worldwide |

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

1. 将项目推到 GitHub 公开仓库
2. Settings → Pages → Branch 选 `main`，目录选 `/docs`
3. 隐私政策地址为：

```
https://你的GitHub用户名.github.io/bilibili-downloader/
```

填到 Edge Partner Center 的 **Privacy Policy URL**。

---

## 第五步：Store listing（商店详情）— 中文

### Extension name（来自 manifest，上传后只读）

B站视频下载助手

### Description（详细描述）

```
B站视频下载助手帮助您在哔哩哔哩视频页面保存视频为 MP4 文件。

主要功能：
• 自动识别当前 B 站视频页，显示标题、UP 主、可用清晰度
• 支持 360P～1080P 等真实可下载清晰度（以视频源为准）
• 高清视频自动合并音视频，输出 MP4
• 右下角悬浮面板，一键下载
• 完全免费，不收集任何用户数据

使用说明：
1. 打开 bilibili.com 任意视频页
2. 点击右下角悬浮按钮或浏览器工具栏图标
3. 选择清晰度 → 开始下载

重要说明：
• 仅供个人学习与研究，请遵守 B 站用户协议与著作权法
• 不破解大会员、不绕过付费番剧
• 登录 B 站账号可获得更高清晰度
• 下载失败时建议先播放几秒视频再试

反馈 QQ：748604487
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

1. B 站视频页 + 右下角下载面板打开
2. 浏览器工具栏 popup 显示视频信息
3. 清晰度选择与「开始下载」按钮

---

## 第七步：Certification notes（审核备注，可选）

```
本扩展为 Manifest V3，无远程代码，不收集用户数据。
仅在用户主动操作时于 bilibili.com 视频页本地下载并合并 MP4。
不绕过登录、会员或付费限制。隐私政策见：[你的 privacy.html URL]
测试：打开任意公开 BV 视频 → 右下角按钮 → 选择 720P → 下载。
```

---

## 第八步：Submit for review

检查所有必填项 → Submit → 等待审核（通常数天）

---

## 若被拒

- 查看 Partner Center 邮件中的具体原因
- 保留 zip 离线分发 + QQ 反馈
- 可调整后重新提交，不必改代码
