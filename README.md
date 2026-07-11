# B站视频下载助手

Microsoft Edge / Chrome 浏览器扩展（Manifest V3）。在 B 站视频页保存视频为 MP4，仅供个人学习使用。

- 版本：1.0.0
- 反馈 QQ：748604487

## 隐私政策

https://YOUR_GITHUB_USERNAME.github.io/bilibili-downloader/

（推送 GitHub 并开启 Pages 后，将上面链接中的 `YOUR_GITHUB_USERNAME` 换成你的用户名）

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
