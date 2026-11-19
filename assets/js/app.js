/**
 * 博客前端逻辑 v2
 * ------------------------------------------------------------------
 * 数据来自 content/data.json（由后台管理界面维护）
 * 支持：自定义分类、文章图片、内嵌播放器、站点设置、明暗主题
 */

let DATA = { site: {}, categories: [], posts: [] };

/* ---------------- 数据加载 ---------------- */

async function loadData() {
  const res = await fetch("content/data.json", { cache: "no-store" });
  if (!res.ok) throw new Error("无法加载数据");
  const json = await res.json();
  DATA = Object.assign({ site: {}, categories: [], posts: [] }, json);
}

/* ---------------- 主题 ---------------- */

function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.innerHTML = theme === "dark"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#theme-toggle")) {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateThemeIcon(next);
  }
});

/* ---------------- 工具函数 ---------------- */

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(url) {
  const u = String(url || "").trim();
  if (/^(https?:\/\/|mailto:|\/|data:image\/|#)/i.test(u)) return u;
  return "#";
}

function formatDate(dateStr) {
  const d = new Date(String(dateStr) + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  const months = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  return `${d.getFullYear()} 年 ${months[d.getMonth()]} ${d.getDate()} 日`;
}

function readingTime(content) {
  const chars = String(content).replace(/\s/g, "").length;
  return `${Math.max(1, Math.round(chars / 300))} 分钟阅读`;
}

function getCategory(id) {
  return DATA.categories.find((c) => c.id === id);
}

function categoryChip(id) {
  const cat = getCategory(id);
  if (!cat) return "";
  const color = cat.color || "var(--text-muted)";
  return `<span class="cat-chip" style="--chip-color:${escapeHtml(color)}">${escapeHtml(cat.name)}</span>`;
}

/* ---------------- 播放器 / 图片 渲染 ---------------- */

function buildPlayer(url) {
  const u = safeUrl(url);
  if (u === "#") return `<p class="embed-error">无效的播放器链接</p>`;
  let src = u;
  let ratio = "16 / 9";
  let extra = "allowfullscreen";

  // 哔哩哔哩
  let m = u.match(/bilibili\.com\/video\/(BV[\w]+)/i);
  if (m) src = `https://player.bilibili.com/player.html?bvid=${m[1]}&high_quality=1&autoplay=0`;
  // YouTube
  m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
  if (m) src = `https://www.youtube.com/embed/${m[1]}`;
  // 网易云音乐
  m = u.match(/music\.163\.com\/(?:#\/)?(song|album|playlist|radio)\?id=(\d+)/i);
  if (m) { src = `https://music.163.com/outchain/player?type=${m[1] === "song" ? 2 : m[1] === "album" ? 1 : m[1] === "playlist" ? 0 : 3}&id=${m[2]}&auto=0`; ratio = "auto"; extra = ""; }
  // Spotify
  m = u.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([\w]+)/i);
  if (m) { src = `https://open.spotify.com/embed/${m[1]}/${m[2]}`; ratio = "auto"; extra = ""; }
  // SoundCloud
  if (/soundcloud\.com/i.test(u)) { src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(u)}`; ratio = "auto"; extra = ""; }
  // 腾讯视频
  m = u.match(/v\.qq\.com\/x\/cover\/[^\/]+\/([^\.]+)\.html/i);
  if (m) src = `https://v.qq.com/txp/iframe/player.html?vid=${m[1]}`;

  const heightStyle = ratio === "auto" ? "height:152px" : `aspect-ratio:${ratio}`;
  return `<div class="embed-player" style="${heightStyle}"><iframe src="${escapeHtml(src)}" frameborder="0" ${extra} loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
}

function buildMedia(tag, url) {
  const u = safeUrl(url);
  if (u === "#") return "";
  return `<div class="embed-media"><${tag} controls src="${escapeHtml(u)}"></${tag}></div>`;
}

/* ---------------- 轻量 Markdown 渲染器 ---------------- */

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${escapeHtml(safeUrl(href))}" target="_blank" rel="noopener">${label}</a>`);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img class="article-img" src="${escapeHtml(safeUrl(src))}" alt="${escapeHtml(alt)}" loading="lazy">`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

function renderMarkdown(md) {
  const lines = String(md || "").trim().split("\n");
  const out = [];
  let i = 0;
  let inList = false, listType = "";

  function closeList() {
    if (inList) { out.push(`</${listType}>`); inList = false; }
  }

  while (i < lines.length) {
    const line = lines[i];

    // 独立图片行
    let mImg = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (mImg) {
      closeList();
      out.push(`<figure class="article-figure"><img class="article-img" src="${escapeHtml(safeUrl(mImg[2]))}" alt="${escapeHtml(mImg[1])}" loading="lazy">${mImg[1] ? `<figcaption>${escapeHtml(mImg[1])}</figcaption>` : ""}</figure>`);
      i++; continue;
    }

    // 播放器指令 {{player:url}} / {{audio:url}} / {{video:url}} / {{iframe:url}}
    let mEmbed = line.match(/^\s*\{\{(player|audio|video|iframe):([^}]+)\}\}\s*$/i);
    if (mEmbed) {
      closeList();
      const type = mEmbed[1].toLowerCase();
      const url = mEmbed[2].trim();
      if (type === "player" || type === "iframe") out.push(buildPlayer(url));
      else out.push(buildMedia(type, url));
      i++; continue;
    }

    // 代码块
    if (line.trim().startsWith("```")) {
      closeList();
      i++;
      const code = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) { code.push(escapeHtml(lines[i])); i++; }
      out.push(`<pre><code>${code.join("\n")}</code></pre>`);
      i++; continue;
    }

    // 标题
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i++; continue;
    }

    // 引用
    if (line.trim().startsWith("> ")) {
      closeList();
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) { quote.push(inlineMarkdown(lines[i].trim().slice(2))); i++; }
      out.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
      continue;
    }

    // 分隔线
    if (/^\s*---+\s*$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }

    // 无序列表
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (!inList || listType !== "ul") { closeList(); out.push("<ul>"); inList = true; listType = "ul"; }
      out.push(`<li>${inlineMarkdown(ul[1])}</li>`); i++; continue;
    }

    // 有序列表
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (!inList || listType !== "ol") { closeList(); out.push("<ol>"); inList = true; listType = "ol"; }
      out.push(`<li>${inlineMarkdown(ol[1])}</li>`); i++; continue;
    }

    if (line.trim() === "") { closeList(); i++; continue; }

    closeList();
    const para = [];
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !lines[i].match(/^(#{1,3})\s+/) &&
      !lines[i].trim().startsWith("> ") &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].match(/^\s*\{\{(player|audio|video|iframe):/i) &&
      !lines[i].match(/^\s*!\[[^\]]*\]\([^)]+\)\s*$/) &&
      !lines[i].match(/^[-*]\s+/) && !lines[i].match(/^\d+\.\s+/)
    ) { para.push(inlineMarkdown(lines[i])); i++; }
    if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
  }
  closeList();
  return out.join("\n");
}

/* ---------------- 组件 ---------------- */

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>',
  arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
};

function renderHeader(active) {
  const s = DATA.site;
  return `
  <header class="site-header"><div class="container header-inner">
    <a href="index.html" class="site-brand">${escapeHtml(s.name)}<span class="brand-dot">.</span></a>
    <nav class="site-nav">
      <a href="index.html" class="nav-link ${active === "home" ? "active" : ""}">首页</a>
      <a href="about.html" class="nav-link ${active === "about" ? "active" : ""}">关于</a>
      <button id="theme-toggle" class="theme-toggle" aria-label="切换主题"></button>
    </nav>
  </div></header>`;
}

function renderFooter() {
  const s = DATA.site;
  const links = (s.footerLinks || []).map((l) => `<a href="${escapeHtml(safeUrl(l.url))}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join("");
  const footnote = s.footnote ? ` · ${escapeHtml(s.footnote)}` : "";
  return `
  <footer class="site-footer"><div class="container footer-inner">
    <span>© ${new Date().getFullYear()} ${escapeHtml(s.author)}${footnote}</span>
    <div class="footer-links">${links}</div>
  </div></footer>`;
}

/* ---------------- 首页 ---------------- */

function renderHome() {
  const s = DATA.site;
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="page-wrapper">
      ${renderHeader("home")}
      <main>
        <section class="hero"><div class="container">
          <h1>${escapeHtml(s.tagline)}</h1>
          <p>${escapeHtml(s.description)}</p>
          <div class="hero-actions">
            <a href="#posts" class="btn btn-primary">浏览文章 ${ICONS.arrowRight}</a>
            <a href="about.html" class="btn btn-ghost">了解更多</a>
          </div>
        </div></section>
        <div class="container">
          <div class="toolbar" id="posts">
            <div class="search-box">${ICONS.search}<input type="text" id="search-input" placeholder="搜索文章..." autocomplete="off"></div>
            <div class="tag-filters" id="tag-filters">
              <button class="tag-filter active" data-cat="all">全部</button>
              ${DATA.categories.map((c) => `<button class="tag-filter" data-cat="${escapeHtml(c.id)}"><span class="filter-dot" style="background:${escapeHtml(c.color || "#888")}"></span>${escapeHtml(c.name)}</button>`).join("")}
            </div>
          </div>
          <ul class="post-list" id="post-list"></ul>
        </div>
      </main>
      ${renderFooter()}
    </div>`;

  let activeCat = "all", query = "";
  function renderList() {
    const list = document.getElementById("post-list");
    const kw = query.trim().toLowerCase();
    const filtered = DATA.posts.filter((p) => {
      const catMatch = activeCat === "all" || (p.categoryIds || []).includes(activeCat);
      const textMatch = !kw || p.title.toLowerCase().includes(kw) || p.excerpt.toLowerCase().includes(kw) || (p.categoryIds || []).some((id) => (getCategory(id)?.name || "").toLowerCase().includes(kw));
      return catMatch && textMatch;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (!filtered.length) { list.innerHTML = `<li class="empty-state">${ICONS.inbox}<p>没有找到匹配的文章</p></li>`; return; }

    list.innerHTML = filtered.map((post, idx) => `
      <li class="post-item" style="animation-delay:${idx * 0.04}s">
        <a href="post.html?slug=${encodeURIComponent(post.slug)}">
          <div class="post-item-body">
            <div class="post-meta"><span>${formatDate(post.date)}</span><span class="dot"></span><span>${readingTime(post.content)}</span></div>
            <h2>${escapeHtml(post.title)}</h2>
            <p class="post-excerpt">${escapeHtml(post.excerpt)}</p>
            <div class="post-tags">${(post.categoryIds || []).map(categoryChip).join("")}</div>
          </div>
          ${post.cover ? `<div class="post-thumb"><img src="${escapeHtml(safeUrl(post.cover))}" alt="" loading="lazy"></div>` : ""}
        </a>
      </li>`).join("");
  }

  document.getElementById("search-input").addEventListener("input", (e) => { query = e.target.value; renderList(); });
  document.getElementById("tag-filters").addEventListener("click", (e) => {
    const btn = e.target.closest(".tag-filter");
    if (!btn) return;
    document.querySelectorAll(".tag-filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeCat = btn.dataset.cat;
    renderList();
  });
  renderList();
}

/* ---------------- 文章页 ---------------- */

function renderPost() {
  const app = document.getElementById("app");
  const slug = new URLSearchParams(window.location.search).get("slug");
  const post = DATA.posts.find((p) => p.slug === slug);
  if (!post) {
    app.innerHTML = `<div class="page-wrapper">${renderHeader("home")}<main><div class="container"><div class="empty-state">${ICONS.inbox}<p>文章不存在</p><a href="index.html">返回首页</a></div></div></main>${renderFooter()}</div>`;
    return;
  }
  document.title = `${post.title} — ${DATA.site.name}`;
  app.innerHTML = `
    <div class="page-wrapper">
      ${renderHeader("home")}
      <main><article class="article"><div class="container">
        <header class="article-header">
          <a href="index.html" class="back-link">${ICONS.arrowLeft} 返回首页</a>
          <h1>${escapeHtml(post.title)}</h1>
          <div class="post-meta"><span>${formatDate(post.date)}</span><span class="dot"></span><span>${readingTime(post.content)}</span></div>
          <div class="post-tags" style="margin-top:14px">${(post.categoryIds || []).map(categoryChip).join("")}</div>
        </header>
        ${post.cover ? `<figure class="article-figure cover"><img class="article-img" src="${escapeHtml(safeUrl(post.cover))}" alt="" loading="lazy"></figure>` : ""}
        <div class="article-content">${renderMarkdown(post.content)}</div>
      </div></article></main>
      ${renderFooter()}
    </div>`;
}

/* ---------------- 关于页 ---------------- */

function renderAbout() {
  const s = DATA.site;
  const app = document.getElementById("app");
  const avatarHtml = s.avatar
    ? `<img src="${escapeHtml(safeUrl(s.avatar))}" alt="${escapeHtml(s.author)}" class="about-avatar">`
    : `<div class="about-avatar">${escapeHtml(s.author.charAt(0).toUpperCase())}</div>`;
  app.innerHTML = `
    <div class="page-wrapper">
      ${renderHeader("about")}
      <main><div class="container"><div class="about">
        ${avatarHtml}
        <h1>你好，我是 ${escapeHtml(s.author)} 👋</h1>
        <div class="about-body">
          <p>欢迎来到我的个人空间。这里记录我在技术探索、设计思考与日常生活中积累的点滴。</p>
          <p>${escapeHtml(s.description)}如果你对我的想法有任何看法，欢迎通过下方方式联系我。</p>
          <h2>联系方式</h2>
          <p>${(s.footerLinks || []).map((l) => `<a href="${escapeHtml(safeUrl(l.url))}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join(" · ") || escapeHtml(s.email)}</p>
        </div>
      </div></div></main>
      ${renderFooter()}
    </div>`;
}

/* ---------------- 启动 ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  try {
    await loadData();
    const page = document.body.dataset.page || "home";
    if (page === "post") renderPost();
    else if (page === "about") renderAbout();
    else renderHome();
  } catch (err) {
    console.error(err);
    document.getElementById("app").innerHTML = `<div class="container" style="padding:80px 24px;text-align:center"><p>数据加载失败，请刷新重试。</p></div>`;
  }
});
