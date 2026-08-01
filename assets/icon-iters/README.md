图标迭代说明（审美评审）

> ⚠️ **已废弃：** 下表为旧「深色底蓝环 TV」方案的过程稿，仅存档。当前定稿改为 B 站蓝播放键（蓝底 `#00A1D6` + 白三角，形状同 YouTube 播放键），见下方「当前定稿」。

基准：深色底 + 蓝断环 + 粉播放 + 粉下载（第二参考图）

| 代 | 文件 | 评审 |
|----|------|------|
| 01 | `icon-iter-01.png` | 基准：球头天线+断环 |
| 02 | `icon-iter-02.png` | 加粗，16px 可读 |
| 03 | `icon-iter-03.png` | 短天线+更多留白 |
| 04 | `icon-iter-04.png` | 微倾天线 TV 感 |
| 05 | `icon-iter-05.png` | 无天线极简 |
| 06 | `icon-iter-06.png` | 宽断口突出下载 |
| 07 | `icon-iter-07.png` | 微霓虹光晕 |
| 08 | `icon-iter-08.png` | 更深底+饱和 |
| 09 | `icon-iter-09.png` | 无托盘更轻 |
| 10 | `icon-iter-10.png` | 外圈层次 |
| 11 | `icon-iter-11.png` | 候选：重量均衡 |
| 12 | `icon-iter-12.png` | 旧定稿：含粉播放三角 |
| 13 | `icon-iter-13.png` | ★定稿：★定稿：去三角、放大下载、收紧留白 |

定稿：`assets/icon-source.png` / `icons/icon*.png`
重生：`python scripts/gen_icon_iters.py`

## 当前定稿（新方案）

- 形状：B 站蓝播放键（蓝底 + 白三角），与 youtube-downloader 图标结构一致
- 生成：`python scripts/gen_icons.py` —— 读 `youtube-downloader/assets/icon-source.png`，红→蓝 `#00A1D6`、白保持、其余透明
- 输出：`icons/icon16/32/48/128.png` + `assets/icon-source.png`（1024）
