# B站视频下载助手

Microsoft Edge / Chrome 浏览器扩展（Manifest V3）。在 B 站视频页保存视频为 MP4，仅供个人学习使用。

- 版本：1.0.0
- 反馈 QQ：748604487

## 功能概览

- 在 B 站**普通视频页**（`/video/BV…`）保存 MP4，不支持番剧页
- 右下角悬浮面板：视频信息、清晰度选择、**真实进度条**、**暂停/继续/取消**
- 工具栏 popup：视频页预览信息；非视频页引导跳转
- 高清自动合并音视频；360P～1080P 以源为准
- 完全免费，不收集用户数据

## 隐私政策

https://YOUR_GITHUB_USERNAME.github.io/bilibili-downloader/

（推送 GitHub 并开启 Pages 后，将上面链接中的 `YOUR_GITHUB_USERNAME` 换成你的用户名）

## 开发者

详见 **[DEVELOPER.md](DEVELOPER.md)**（新开会话先读此文档即可继续开发）。

## 本地加载

1. `chrome://extensions` 或 `edge://extensions`
2. 开启「开发者模式」
3. 「加载 unpacked」→ 选择本目录

## 打包

```bash
python scripts/pack.py
```

## Edge 上架

见 [store/EDGE_SUBMIT.md](store/EDGE_SUBMIT.md)
