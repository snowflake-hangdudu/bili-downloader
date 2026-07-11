# GitHub Pages 托管隐私政策

Edge 商店要求填写 **Privacy Policy URL**，用 GitHub Pages 免费托管 `docs/index.html`。

## 一、创建仓库并推送

在 `bilibili-downloader` 目录下执行（先安装 [GitHub CLI](https://cli.github.com/) 或用手动网页创建仓库）：

```bash
cd bilibili-downloader

git init
git add .
git commit -m "Initial commit: B站视频下载助手 v1.0.0"

# 方式 A：用 gh 创建公开仓库（推荐）
gh repo create bilibili-downloader --public --source=. --push

# 方式 B：已在网页建好空仓库后
# git remote add origin https://github.com/你的用户名/bilibili-downloader.git
# git branch -M main
# git push -u origin main
```

> 仓库需为 **Public（公开）**，免费账号才能用 GitHub Pages。

## 二、开启 GitHub Pages

1. 打开 `https://github.com/你的用户名/bilibili-downloader`
2. **Settings** → 左侧 **Pages**
3. **Build and deployment**
   - Source：**Deploy from a branch**
   - Branch：**main** → 文件夹选 **/docs** → **Save**
4. 等待 1～3 分钟，页面顶部出现绿色地址：

```
https://你的用户名.github.io/bilibili-downloader/
```

## 三、填到 Edge Partner Center

**Privacy Policy URL** 填：

```
https://你的用户名.github.io/bilibili-downloader/
```

备用（与上面相同内容）：

```
https://你的用户名.github.io/bilibili-downloader/privacy.html
```

（若只部署了 `docs/index.html`，用第一条即可。）

## 四、验证

浏览器打开上述链接，应能看到「B站视频下载助手 · 隐私政策」页面。

## 五、更新隐私政策

1. 修改 `docs/index.html` 和 `store/privacy.html`（保持同步）
2. `git add docs/index.html store/privacy.html`
3. `git commit -m "Update privacy policy"`
4. `git push`

Pages 会自动重新部署。

## 不想公开源码？

可另建小仓库 **仅含隐私页**：

```bash
mkdir bili-dl-privacy && cd bili-dl-privacy
mkdir docs
# 复制 docs/index.html 到此
git init && git add . && git commit -m "Privacy policy"
gh repo create bili-dl-privacy --public --push
```

Pages URL 变为：`https://你的用户名.github.io/bili-dl-privacy/`
