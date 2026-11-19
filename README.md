# Jacques' Notes

一个现代化、简约风格的个人博客，纯静态、零依赖，可直接部署到 GitHub Pages。

## 特性

- 简约现代的设计，浅色 / 深色主题自动切换并记忆偏好
- 首页文章列表、关键词搜索、**自定义分类**筛选（名称/颜色可配）
- 轻量 Markdown 渲染 + 文章图片 + **内嵌播放器**（B站/YouTube/网易云/音频等）
- **后台管理**（`admin.html`）：可视化管理站点设置、分类、文章
- 后台采用**自定义密码 + AES-GCM 加密**保护 GitHub 凭据，源码零明文
- 响应式布局，适配移动端
- 404 页面、自定义 favicon

## 本地预览

在项目目录运行任意静态服务器，例如：

```bash
python -m http.server 8000
```

然后访问 http://localhost:8000

## 部署到 GitHub Pages

1. 在 GitHub 创建一个名为 `<你的用户名>.github.io` 的仓库
2. 将本目录所有文件推送到该仓库的 `main` 分支
3. 进入仓库 Settings → Pages，Source 选择 `Deploy from a branch`，分支选 `main`、目录选 `/ (root)`
4. 等待部署完成，访问 `https://<你的用户名>.github.io`

> `.nojekyll` 文件已包含，确保 GitHub Pages 不跳过以 `_` 开头的文件。

## 后台管理与安全

访问 `admin.html`：

1. **首次使用**：设置一个自定义密码（≥6 位）+ 填入有 `Contents (读写)` 权限的 GitHub 令牌，点「设置密码并进入」。
2. **以后登录**：只需输入密码即可解锁，无需再输令牌。
3. **安全机制**：密码经 PBKDF2（25 万次迭代 + 随机 salt）派生密钥，令牌用 AES-GCM 加密后仅存于浏览器 `localStorage`。**源码和仓库中不含任何明文凭据**；密码本身从不存储。忘记密码只能「重置凭据」重新输入令牌。
4. 令牌在页面打开期间只存在于内存中，关闭页面即失效。

> ⚠️ 由于静态站点没有服务端，加密是"客户端加密"：它能防止别人翻源码/翻本地存储看到明文，但密码强度你自己把握。请勿使用弱密码。

## 自定义内容

所有内容集中在 `content/data.json`，也可以通过后台可视化编辑（推荐）：

- `site`：站点名、作者、标语、邮箱、GitHub、页脚脚注、页脚链接
- `categories`：自定义分类，每项含 `id` / `name` / `color`
- `posts`：文章数组，含 `slug` / `title` / `date` / `categoryIds` / `excerpt` / `cover` / `content`

文章 `content` 支持的语法：
- 基础 Markdown：`# 标题`、`**粗体**`、`*斜体*`、`` `代码` ``、`> 引用`、`- 列表`、`1. 列表`、`[链接](url)`、代码块
- 图片：`![说明](图片URL)`（后台可上传图片自动填 URL）
- 内嵌播放器（独占一行）：
  - `{{player:https://www.bilibili.com/video/BVxxx}}` — B站
  - `{{player:https://www.youtube.com/watch?v=xxx}}` — YouTube
  - `{{player:https://music.163.com/#/song?id=xxx}}` — 网易云音乐
  - `{{audio:https://.../xxx.mp3}}` / `{{video:https://.../xxx.mp4}}` — 原生音视频

## 结构

```
.
├── index.html          # 首页
├── post.html           # 文章页（?slug=xxx）
├── about.html          # 关于页
├── admin.html          # 后台管理
├── 404.html            # 404 页面
├── favicon.svg         # 站点图标
├── .nojekyll
├── content/
│   └── data.json       # 所有站点与文章数据
└── assets/
    ├── css/
    │   ├── style.css   # 前台样式
    │   └── admin.css   # 后台样式
    ├── js/
    │   ├── app.js      # 前台逻辑
    │   └── admin.js    # 后台逻辑（含加密）
    └── images/         # 后台上传的图片
```
