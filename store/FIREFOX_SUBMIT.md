# Firefox 上架清单

适用时间：2026-08-04

## 入口

- 开发者后台：https://addons.mozilla.org/developers/
- 发布说明：https://extensionworkshop.com/documentation/publish/publishing-your-add-on/

## 打包

```bash
python scripts/pack_firefox.py
```

生成：`bilibili-downloader-firefox.xpi`

## 当前包内关键设置

- Manifest V3
- Firefox 后台使用 `background.scripts`
- Gecko ID：`bilibili-downloader@hangdudu.local`
- 最低版本：`121.0`

## 建议填写

**名称**

- Bilibili Video Download Assistant

**简介**

- Download Bilibili /video pages as MP4 or M4A with quality selection, A/V merge, multi-part queue, and local history. Personal learning only. No user data collected.

**权限说明**

- `activeTab`：仅在当前 Bilibili 视频页读取页面信息
- `scripting`：在当前页注入下载所需脚本
- `storage`：保存本地下载历史、按钮位置和自动展开状态
- Host permissions：仅限 `bilibili.com` / `bilivideo.com` / `bilivideo.cn` 相关域名

## 上架前自查

- 说明页里明确写“仅供个人学习使用”
- 不写“下载所有 B 站内容”这类过度表述
- 隐私项选择“不收集数据”
- 准备 1 张产品图标和 1 到 3 张截图

## 备注

- 现有 Chrome / Edge 素材可直接复用大部分文案与截图
- Firefox 版包名单独输出，避免和 Chrome / Edge 包混用
