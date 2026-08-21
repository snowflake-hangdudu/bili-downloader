# B站视频下载助手

Microsoft Edge / Chrome / Firefox 浏览器扩展（Manifest V3）。在 B 站普通视频页保存视频为 MP4 / M4A，仅供个人学习使用。

- 版本：1.0.4
- 反馈邮箱：hangdudu0@agent.qq.com
- 商店直链（Edge）：https://microsoftedge.microsoft.com/addons/detail/fdcimmiafpnpkehegehnjjkllogfjmem

## 功能概览

- 在 B 站**普通视频页**（`/video/BV…`）下载；**不支持番剧页**
- 右下角悬浮面板：清晰度 / 格式（MP4 视频 · M4A 音频）、最多 3 路并行进度卡、暂停/继续/取消
- 多分 P 可队列下载（可「取消整队」）；失败自动重试 1 次
- 本地下载历史（最近 50 条，可跳回重下并自动展开面板）
- 悬浮按钮可拖拽（窗口缩放后自动夹回可视区）；站内切视频即时刷新
- 工具栏 popup：视频页预览；非视频页明确「仅 /video」引导
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

Firefox 发布包：

```bash
python scripts/pack_firefox.py
```

## 商店上架

| 商店 | 文档 |
|------|------|
| Microsoft Edge | [store/EDGE_SUBMIT.md](store/EDGE_SUBMIT.md) |
| Chrome Web Store | [store/CHROME_SUBMIT.md](store/CHROME_SUBMIT.md) |
| Firefox Add-ons (AMO) | [store/FIREFOX_SUBMIT.md](store/FIREFOX_SUBMIT.md) |
| 图片资源 | [store/SCREENSHOTS.md](store/SCREENSHOTS.md) |
