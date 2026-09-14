# Cursor 执行任务：设置页、自定义文件名、MP3 本地转换

## 任务和边界

在 `D:\插件\下载类\bilibili-downloader` 实施以下功能。先阅读仓库 AGENTS.md 和当前代码，保留已有改动。本文基于 2026-09-15 的 1.1.7 源码检查，不得假设文件未变化。完成实现与测试；不要自动升级版本、打包、提交 Git 或发布商店。

目标：把文件名设置移入独立设置页；支持用户编辑命名模板；下载面板增加 MP3 音频；音频在用户浏览器本地完成真实转换，无须安装桌面程序、启动 localhost 服务或上传音频。

## 已确认的代码入口

- `manifest.json`：MV3，目前无 options_ui；Edge/Chrome 使用 service worker。
- `content/content.js`：`filenameStyle`、`buildFilenameBase`、`refreshFilenamePreview`、`persistDownloadPrefs` 附近的偏好写入逻辑；当前只有 title/title-bvid/title-bvid-quality/detailed 四种预设。删除面板控件时必须一起移除 `filenameStyleEl.onchange` 等绑定，防止空元素异常导致面板失效。
- `captureDownloadJob`、`runSingleDownload`、合集队列：任务快照、音频下载和保存入口。注意当前命名和部分偏好仍读取全局变量，必须改成任务快照。
- `content/content.js` 的 `downloadBlob` 与 `background.js` 的 `BILI_DL_SAVE_MEDIA`：只接受 mp4/m4a；MP3 必须同步扩展格式校验、MIME、保存完成确认。
- `popup/popup.js` 和 content 的历史格式处理：存在“非 m4a 一律 mp4”的二元判断，必须全局排查。
- `scripts/pack.py`、`scripts/pack_firefox.py`：固定文件白名单，新文件必须进入两个脚本。

## 一、设置页与命名

新增 `options/options.html`、`options/options.css`、`options/options.js`。Manifest 使用 `options_ui: { page: 'options/options.html', open_in_tab: true }`。Popup 和悬浮面板各加一个“设置”入口，通过后台调用 runtime.openOptionsPage；设置页沿用现有蓝白视觉、图标及 shared/design-system.css，支持键盘、清晰标签与保存反馈。

设置页只包含本次需要的两组设置：

1. 文件命名：预设、自定义模板、变量插入按钮、实时预览、保存、恢复默认。
2. 音频：默认音频格式 M4A/MP3、MP3 比特率 128/192/256/320 kbps，默认 192。说明“MP3 需要本地转换；提高比特率不会恢复源音频中不存在的细节”。保留现有用户默认格式，不把旧用户自动切换成 MP3。

新增 `shared/download-settings.js` 和 `shared/filename.js`，用当前工程可加载的模块形式实现，不强行引入框架。使用独立版本化 storage.local key，避免现有整对象偏好写入覆盖新配置。迁移旧 filenameStyle：title → `{title}`，title-bvid → `{title} - {bvid}`，title-bvid-quality → `{title} - {bvid} - {quality}`，detailed → `{title} - {author} - {bvid} - {quality}`。迁移幂等，已有新设置优先。

支持变量：`{title}`、`{author}`、`{bvid}`、`{part}`、`{partTitle}`、`{index}`、`{quality}`、`{date}`。提供每个变量的说明；part 为实际分 P 编号，index 为选中批次的顺序编号，单视频为 1；date 为任务创建当天本地日期 YYYY-MM-DD；编号统一至少两位。元数据缺失不得编造，使用明确回退，例如 partTitle 回退 title。预览用固定示例并注明“示例预览”。

文件后缀由实际输出格式追加，不允许模板伪装文件类型。纯替换解析，不使用 eval、动态 Function 或 HTML 注入；未知变量阻止保存并提示。处理 Windows 非法字符、控制字符、保留设备名、末尾空格/点、空模板、路径分隔符与路径穿越；截断不切坏 Unicode 字符，并给后缀及重复文件编号留余量。采用保守文件名长度上限，真实保存失败需可读提示。默认继续 conflictAction=uniquify，避免覆盖。

面板移除文件名选择器及其编辑控件，可以保留一行最终文件名预览。storage.onChanged 更新尚未创建的任务偏好。任务创建时冻结模板、格式、MP3 码率、时间与编号；运行中改设置不改变已入队任务的文件名或重试结果。合集项目使用自己的元数据，不能取当前播放页标题。

## 二、MP3 本地转换架构

首版选用随扩展打包的单线程 ffmpeg.wasm（包含 AAC 解码和 MP3 编码能力），在扩展自己的转换标签页中运行专用 Worker。新增 `conversion/conversion.html`、`conversion/conversion.js`、`conversion/conversion.css`、转换任务模块和 `vendor/ffmpeg/`。先完成小样本原型，确认选定构建确有 libmp3lame/等效 MP3 编码能力，再接业务。

使用实际锁定版本的官方依赖，保存版本、校验值、许可证及可复现获取/构建说明。JS/WASM/Worker 全部本地打包，不运行 CDN 脚本或远程下载的 WASM。只按官方要求为扩展页面配置最小 WASM CSP；不得放宽 B 站页面 CSP。不要默认使用多线程核心、SharedArrayBuffer 或 offscreen，减少跨浏览器差异。转换页按需创建且复用，页面显示进度并告知“转换期间请保持此页打开”。

转换标签页是明确的首版产品选择：关闭 Popup、收起下载面板不影响转换；关闭转换页会中断任务并可重试。下载阶段仍遵循保持原 B 站页面打开的现有约束，不宣称关闭来源页也能继续下载。

MP3 流程：获取当前用户可访问的音频 → 暂存源音频 → 本地转换为真实 MP3 → 验证输出非空且可解析 → 使用 audio/mpeg 和 .mp3 保存 → downloads 确认 complete 后完成任务并清理。M4A 原格式下载继续保留，MP3 不先合成整段 MP4。没有独立音轨的资源要明确处理：若复用现有来源容器抽音轨，应计入资源预算；否则提示该资源暂不支持 MP3，不生成伪音频。

音频转换必须显式指定仅音频输出和所选码率，保持合法采样率/声道或进行必要兼容转换。M4A/AAC 到 MP3 是有损再编码，不能宣传无损或提高源音质。首版不额外做封面嵌入和复杂标签编辑。

### 跨上下文传输与保存

禁止通过 runtime.sendMessage 传输整段 Blob、ArrayBuffer、PCM 或 Base64；Chrome 消息序列化与 Firefox 不同，巨量数据会造成额外内存复制。

实现受控的分块暂存通道：内容脚本通过专用 Port 逐块发送有上限的编码数据，接收方写入扩展源 IndexedDB；收到写入 ACK 后再发下一块，最多一个未确认块。第一版建议原始块 256 KiB，编码开销计入预算；数据量虽小也不可无边界排队。任务授权绑定来源 tabId、jobId 和随机任务凭据，验证块序号、累计大小及声明上限；断连任务可识别并清理。转换页只读取获准 jobId 的输入。若实现更高效的流式通道，必须证明跨浏览器有效后替换，不假定页面 Blob URL 可以直接跨源 fetch。

转换页创建最终输出 Blob URL，后台只接受本扩展转换页发起的合法保存请求；扩展现有来源校验以接受这个受信来源，不能放开任意 URL 或网页发起保存。URL 保留到浏览器明确完成/中断；失败保留可重试状态，不重复提交保存。所有终止路径关闭 Worker、释放对象 URL、删除临时记录。

## 三、性能与任务稳定性

- 全局同一时间最多一项 MP3 转换，覆盖多个 B 站标签页。合集继续顺序下载→转换→保存，上一项完成后才启动下一项，避免堆积所有音频。
- 首版保守 MP3 输入预算 64 MiB：这是临时工程预算，并非浏览器上限，需要用实测调整。下载和分块传输期间按实际累计字节再次检查，不能仅相信预计大小。限制只用于转码，不重新限制普通 MP4/M4A 下载数量或大小。
- 单线程 WASM 仍可能占用明显 CPU/内存，不承诺零影响。不要使用整段 decodeAudioData 展开长音频 PCM，不在 B 站主线程上编码。
- 输入过大、配额不足、初始化失败、无进展、Worker 崩溃均进入可重试错误；提示“改为下载原始 M4A”，由用户主动选择，不能静默改格式。临时源存在时重试转换优先复用，避免重下载。
- 设置独立初始化超时与可配置的转换无进展检测；无进展以日志/实际处理事件判断，不用简单固定总时长误杀长音频。错误需附可读阶段信息。
- 暂停全部立即阻止下一任务启动。正在转换时若引擎无可靠暂停，显示“当前转换完成后暂停”，允许完成当前保存；不得显示已经暂停却仍偷偷运行。取消全部应终止转换 Worker、清理暂存并释放锁。
- service worker 重启后从持久化状态恢复管理，不能只靠全局内存维持单任务锁。用事务/租约或同等机制防重复领取；编码无法从中间继续时明确“重新转换”。转换页关闭或浏览器重启后，未完成任务标为中断，不标成功。
- 临时数据有过期清理，启动时回收孤儿记录；不删除完成文件或用户历史。失败连续发生时暂停批次并提示，防止循环重试。

## 四、联动改动清单

统一 format 枚举为 mp4/m4a/mp3；检查所有音频分支、历史去重、重试、格式标签、预计大小、保存后缀、MIME、批次快照。MP3 预计大小按时长和目标码率估算，标明估算。历史只有浏览器确认保存后才标完成。

Manifest 增加 options_ui 和所需最小扩展页 CSP。更新 Chrome/Edge 与 Firefox 打包白名单，缺失必要转换依赖必须令打包失败，禁止 SKIP 后生成看似成功的缺件包。检查 Firefox 背景脚本与 Chrome service worker 两种运行方式。转换资源无须暴露给任意网页。README 补充设置页、MP3 转换成本、关闭页面行为、许可信息。

## 五、按此顺序实施

1. 记录基线及 dirty diff，运行现有测试。完成设置 schema、迁移、纯命名函数与 options 页面。
2. 接入面板及 Popup 设置入口，移除旧控件，冻结队列命名快照。
3. 单独完成扩展转换页的本地 AAC→MP3 原型；验证 Worker/CSP/编解码器与 Edge、Firefox 的可用性。
4. 实现分块暂存、全局串行任务、取消/恢复/清理和可信保存；接入 MP3 下载分支。
5. 修正历史、失败重试、批量与暂停语义；更新双平台打包清单和文档。
6. 完成下列验证，报告实际结果、改动文件和未解决项。不得把静态检查通过写成真实浏览器下载通过。

## 六、完成标准

- 设置页可从两个入口打开，保存/恢复正确；旧命名迁移无丢失；非法模板、Unicode、Windows 设备名、重复文件、缺元数据均覆盖。
- 入队后改模板不影响已有任务；多 P/合集编号标题正确；移除旧控件后列表与单视频按钮均可操作。
- MP3 经 ffprobe/等效工具确认 codec_name=mp3，时长与源一致（允许编码延迟误差），能够播放；MIME audio/mpeg、后缀 .mp3，MP4/M4A 后缀不回归 TXT。
- 覆盖短音频、长音频、超预算、取消、暂停、转换页关闭、来源页导航、配额不足、下载中断、后台重启和重复消息；无重复保存、永久锁或无限重试。
- Edge/Chrome 与 Firefox 分别实测至少一个完整 MP3 下载，并回归 MP4/M4A。记录浏览器版本、输入大小/时长、耗时、内存峰值和播放/滚动响应情况；对比无转换基线，明确硬件条件。
- 执行现有 test/*.test.mjs 中适用测试及新增设置/转换状态测试；回归 worker-bootstrap、cdn-selection、download-runtime、queue-runtime、task-ui-regression。
- 输出可审查代码和测试记录，暂不打包发布。若某浏览器原型失败，说明具体证据并继续完成可独立完成的设置功能，不能假装 MP3 已完成。

## 官方参考

- ffmpeg.wasm 架构与单/多线程核心：https://ffmpegwasm.netlify.app/docs/overview/
- 性能基准（浏览器 WASM 转换存在明显性能成本）：https://ffmpegwasm.netlify.app/docs/performance/
- Chrome offscreen（本方案首版不依赖它）：https://developer.chrome.com/docs/extensions/reference/api/offscreen

注意：方案中的单线程、256 KiB 分块和 64 MiB 预算是本项目建议，需通过实测验证；不是官方性能保证。
