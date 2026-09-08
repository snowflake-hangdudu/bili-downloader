# B站视频下载助手

Microsoft Edge / Chrome / Firefox 浏览器扩展（Manifest V3）。支持 B 站普通视频页与 `/list/` 列表页下载，仅供个人学习使用。

- 版本：1.1.10（列表切换与保存稳定性优化）
- 反馈邮箱：hangdudu0@agent.qq.com
- 商店直链（Edge）：https://microsoftedge.microsoft.com/addons/detail/fdcimmiafpnpkehegehnjjkllogfjmem

## 功能概览

- 固定高码率优先，隐藏视频质量偏好选项；列表及合集支持全选/取消全选当前已加载视频。

- 普通视频页右侧的合集也支持“列表下载”：读取视频接口提供的合集条目，复用勾选、串行下载、暂停/继续/取消功能，无 10 个选择限制。

- 支持 B 站普通视频页（`/video/BV…`、`/video/av…`）和列表页（`/list/…`）；**不支持番剧页**
- 右下角悬浮面板：清晰度 / 格式（MP4 视频 · M4A 音频）、最多 3 路并行进度卡、暂停/继续/取消
- 大文件音视频合成在专用 Worker 执行；自动避免多个大任务并行占用内存，合成期间可关闭面板或取消任务
- 多分 P 可自动顺序队列下载（当前 P 保存后自动开始下一 P）；支持「暂停全部 / 继续全部 / 取消整队」，失败自动重试 1 次
- 列表页提供「单视频 / 列表下载」双标签；列表下载为 MP4，可选清晰度，可选择当前已加载的任意数量视频
- 列表读取 B 站页面当前已加载的视频；长列表请先滚动 B 站页面后点“刷新”，所选视频会自动串行下载
- 失败任务支持重试；面板提供任务中心、浏览器下载内容入口和可复制、已脱敏的诊断日志（含阶段耗时）
- 格式、清晰度及“所选 / 始终最高可用”策略会在本地记忆
- 文件名规则可选，可预览并清理非法字符；可含标题、UP 主、BV 号、分 P、清晰度
- 支持单独下载当前视频封面
- 本地下载历史（最近 50 条，可跳回重下并自动展开面板）
- 悬浮按钮可拖拽（窗口缩放后自动夹回可视区）；站内切视频即时刷新
- 工具栏 popup：普通视频页预览、列表页入口和下载历史
- 公告 / 开发合作内容使用 12 小时本地缓存；缓存有效期内不重复请求接口
- 完全免费，不收集用户数据

更完整说明见 **[功能说明.md](功能说明.md)**；后续版本安排见 **[待开发计划.md](待开发计划.md)**。

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

## 本地检查

```bash
node --check content/content.js
node --check content/page-agent.js
node --check background.js
node test/task-ui-regression.test.mjs
node test/list-pagination-regression.test.mjs
node test/layout-regression.test.mjs
git diff --check
```

> 本地检查不替代真实浏览器下载验收；重载后仍应验证普通视频、分 P、列表、封面和通知。

## 打包（仅在发布时）

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
