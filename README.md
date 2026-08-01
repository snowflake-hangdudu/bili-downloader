# B站视频下载助手

Microsoft Edge / Chrome 浏览器扩展（Manifest V3）。在 B 站普通视频页保存视频为 MP4 / M4A，仅供个人学习使用。

- 版本：1.0.2
- 反馈邮箱：hangdudu@agent.qq.com
- 商店直链（Edge）：https://microsoftedge.microsoft.com/addons/detail/fdcimmafpnpkehegehnjjklloqfjmem

## 功能概览

- 在 B 站**普通视频页**（`/video/BV…`）下载；**不支持番剧页**
- 右下角悬浮面板：清晰度 / 格式（MP4 视频 · M4A 音频）、进度条、暂停/继续/取消
- 多分 P 可队列下载；失败自动重试 1 次
- 本地下载历史（最近 50 条，可跳回重下）
- 悬浮按钮可拖拽；站内切视频即时刷新
- 工具栏 popup：视频页预览信息；非视频页引导跳转
- 完全免费，不收集用户数据

更完整说明见 **[功能说明.md](功能说明.md)**。

## 帮助与隐私

| 页面 | 链接 |
|------|------|
| 常见问题 | https://snowflake-hangdudu.github.io/bili-downloader/faq.html |
| 隐私政策 | https://snowflake-hangdudu.github.io/bili-downloader/ |

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
