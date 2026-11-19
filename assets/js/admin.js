/**
 * 博客后台管理逻辑
 * ------------------------------------------------------------------
 * 通过 GitHub Contents API 读写 content/data.json
 * 安全设计：用户设置自定义密码 → PBKDF2 派生密钥 → AES-GCM 加密令牌
 * 仅加密后的密文存入 localStorage；源码与存储中均无明文凭据
 */

const REPO_OWNER = "jacques1013";
const REPO_NAME = "jacques1013.github.io";
const BRANCH = "main";
const DATA_PATH = "content/data.json";
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

const VAULT_KEY = "blog_admin_vault_v2";   // 仅存加密后的密文（含 salt/iv）
const LEGACY_TOKEN_KEY = "blog_admin_token"; // 旧版明文key，启动时清理

const state = {
  token: "",         // 仅存在于内存，解密后用于 API 调用
  dataSha: "",
  data: { site: {}, categories: [], posts: [] },
  view: "site",
  editingSlug: null,
};

/* ---------------- 加密工具（Web Crypto API） ---------------- */

// 用密码 + 随机 salt 经 PBKDF2 派生 AES-GCM 密钥
async function deriveKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: (window.__PBKDF2_ITER__ || 250000), hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// 加密令牌，返回可存 localStorage 的密文对象
async function encryptToken(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(token)
  );
  return {
    v: 2,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    data: bufToB64(cipher),
  };
}

// 用密码解密令牌；密码错误时 AES-GCM 会抛错
async function decryptToken(vault, password) {
  const salt = b64ToBuf(vault.salt);
  const iv = b64ToBuf(vault.iv);
  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, key, b64ToBuf(vault.data)
  );
  return new TextDecoder().decode(plain);
}

function getVault() {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearCredential() {
  localStorage.removeItem(VAULT_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  state.token = "";
  state.dataSha = "";
}

/* ---------------- 工具 ---------------- */

const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slugify(title) {
  const s = String(title).toLowerCase().trim()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "post-" + Date.now();
}

function showToast(msg, type = "") {
  const t = el("toast");
  t.textContent = msg;
  t.className = "toast " + type;
  t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (t.hidden = true), 2600);
}

function setSaveStatus(msg, isError = false) {
  const s = el("save-status");
  s.textContent = msg;
  s.className = "save-status" + (isError ? " error" : "");
  if (!isError) setTimeout(() => { if (s.textContent === msg) s.textContent = ""; }, 4000);
}

/* ---------------- 主题 ---------------- */

function updateThemeIcon() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const btn = el("theme-toggle");
  if (btn) btn.innerHTML = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg> 切换主题'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> 切换主题';
}
el("theme-toggle")?.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  updateThemeIcon();
});

/* ---------------- GitHub API ---------------- */

async function ghFetch(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${state.token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const err = new Error(body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { body, res };
}

async function loadDataFromGitHub() {
  const { body } = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}?ref=${BRANCH}`);
  state.dataSha = body.sha;
  state.data = JSON.parse(base64ToUtf8(body.content));
  state.data = Object.assign({ site: {}, categories: [], posts: [] }, state.data);
}

async function saveDataToGitHub() {
  const content = utf8ToBase64(JSON.stringify(state.data, null, 2));
  const payload = {
    message: "content: 通过后台更新博客内容",
    content,
    branch: BRANCH,
    ...(state.dataSha ? { sha: state.dataSha } : {}),
  };
  const { body } = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  state.dataSha = body.content?.sha || state.dataSha;
}

async function uploadImage(file) {
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const path = `assets/images/${safeName}`;
  const reader = new FileReader();
  const base64 = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const { body } = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "content: 上传图片",
      content: base64,
      branch: BRANCH,
    }),
  });
  return body.content?.download_url || `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${path}`;
}

/* ---------------- 登录 / 登出 ---------------- */

let vaultMode = "setup"; // "setup" 首次设置 | "unlock" 已有凭据，仅密码解锁

function applyLoginMode() {
  const hasVault = !!getVault();
  vaultMode = hasVault ? "unlock" : "setup";
  el("confirm-field").hidden = hasVault;
  el("token-field").hidden = hasVault;
  el("reset-cred-link").hidden = !hasVault;
  el("login-heading").textContent = hasVault ? "欢迎回来" : "博客后台管理";
  el("login-sub").textContent = hasVault ? "输入管理密码以解锁后台" : "设置一个专用密码，用它加密你的 GitHub 凭据";
  el("login-btn").textContent = hasVault ? "解锁并进入" : "设置密码并进入";
  el("password-hint").textContent = hasVault
    ? "密码不会被存储，仅用于解密凭据。输错则无法解锁。"
    : "密码不会被存储，仅用于加密/解密凭据。请牢记，忘记后无法找回。";
  el("password-input").value = "";
  el("confirm-input").value = "";
  el("token-input").value = "";
  el("login-error").hidden = true;
}

async function doLogin() {
  const password = el("password-input").value;
  if (!password) { showToast("请输入密码", "error"); return; }

  const btn = el("login-btn");
  const errBox = el("login-error");
  btn.disabled = true;
  btn.textContent = "处理中...";
  errBox.hidden = true;

  try {
    if (vaultMode === "setup") {
      const confirm = el("confirm-input").value;
      const token = el("token-input").value.trim();
      if (password.length < 6) throw new Error("密码至少需要 6 位");
      if (password !== confirm) throw new Error("两次输入的密码不一致");
      if (!token) throw new Error("请输入 GitHub 令牌");

      // 先用令牌验证身份与访问，通过后再加密保存
      state.token = token;
      await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}`);
      const vault = await encryptToken(token, password);
      localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } else {
      const vault = getVault();
      if (!vault) throw new Error("未找到凭据，请重置");
      // 解密失败（密码错误）会抛错
      state.token = await decryptToken(vault, password);
      await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}`); // 顺带验证令牌仍有效
    }

    await loadDataFromGitHub();
    el("login-view").hidden = true;
    el("admin-view").hidden = false;
    updateThemeIcon();
    renderView();
    showToast(vaultMode === "setup" ? "设置完成，已登录" : "解锁成功", "success");
  } catch (err) {
    let msg = err.message;
    if (vaultMode === "unlock" && /OperationError|decrypt|InvalidCharacterError/i.test(msg)) {
      msg = "密码错误，无法解密凭据";
    } else if (err.status === 401) msg = "令牌无效或已过期，请重置凭据后重新设置";
    else if (err.status === 403) msg = "权限不足：令牌需要 Contents 读写权限，请检查 Repository permissions";
    else if (err.status === 404) msg = "无法访问仓库，请检查令牌的 Repository access 范围";
    errBox.textContent = msg;
    errBox.hidden = false;
    state.token = "";
  } finally {
    btn.disabled = false;
    btn.textContent = vaultMode === "unlock" ? "解锁并进入" : "设置密码并进入";
  }
}

function doLogout() {
  // 退出只清除内存中的令牌，保留加密凭据以便下次用密码解锁
  state.token = "";
  state.dataSha = "";
  el("admin-view").hidden = true;
  el("login-view").hidden = false;
  applyLoginMode();
}

function doResetCredential() {
  if (!confirm("确定重置凭据吗？这将删除本地加密的令牌，下次需要重新输入令牌设置。")) return;
  clearCredential();
  applyLoginMode();
  showToast("凭据已重置", "success");
}

el("login-btn")?.addEventListener("click", doLogin);
["password-input", "confirm-input", "token-input"].forEach((id) => {
  el(id)?.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
});
el("logout-btn")?.addEventListener("click", doLogout);
el("reset-cred-link")?.addEventListener("click", (e) => { e.preventDefault(); doResetCredential(); });

/* ---------------- 视图切换 ---------------- */

const VIEW_META = {
  site: { title: "站点设置", sub: "管理博客的基本信息与页脚内容" },
  categories: { title: "分类管理", sub: "自定义文章分类的名称与颜色" },
  posts: { title: "文章管理", sub: "撰写、编辑与删除文章" },
};

document.querySelectorAll(".side-link[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".side-link[data-view]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.view = btn.dataset.view;
    renderView();
  });
});

function renderView() {
  const meta = VIEW_META[state.view];
  el("view-title").textContent = meta.title;
  el("view-subtitle").textContent = meta.sub;
  setSaveStatus("");
  const c = el("view-container");
  if (state.view === "site") renderSiteView(c);
  else if (state.view === "categories") renderCategoriesView(c);
  else renderPostsView(c);
}

/* ---------------- 站点设置视图 ---------------- */

function renderSiteView(c) {
  const s = state.data.site;
  c.innerHTML = `
    <div class="card">
      <h3>基本信息</h3>
      <p class="card-desc">这些信息会显示在首页、关于页和各处标题中</p>
      <div class="row">
        <div class="field"><label class="field-label">站点名称</label><input class="input" id="s-name" value="${escapeHtml(s.name)}" placeholder="Jacques' Notes"></div>
        <div class="field"><label class="field-label">作者名</label><input class="input" id="s-author" value="${escapeHtml(s.author)}" placeholder="Jacques"></div>
      </div>
      <div class="field"><label class="field-label">主标语（首页大标题）</label><input class="input" id="s-tagline" value="${escapeHtml(s.tagline)}" placeholder="关于代码、设计与生活的一些思考。"></div>
      <div class="field"><label class="field-label">站点描述</label><textarea class="textarea" id="s-description" placeholder="一段简短的介绍">${escapeHtml(s.description)}</textarea></div>
      <div class="field"><label class="field-label">头像 URL（留空显示首字母）</label><input class="input" id="s-avatar" value="${escapeHtml(s.avatar)}" placeholder="https://..."></div>
    </div>

    <div class="card">
      <h3>联系与页脚</h3>
      <p class="card-desc">自定义邮箱、页脚脚注和底部链接</p>
      <div class="row">
        <div class="field"><label class="field-label">邮箱</label><input class="input" id="s-email" value="${escapeHtml(s.email)}" placeholder="you@example.com"></div>
        <div class="field"><label class="field-label">GitHub 主页</label><input class="input" id="s-github" value="${escapeHtml(s.github)}" placeholder="https://github.com/..."></div>
      </div>
      <div class="field"><label class="field-label">页脚脚注</label><input class="input" id="s-footnote" value="${escapeHtml(s.footnote)}" placeholder="用简洁与热爱构建"><p class="hint">显示在页脚版权信息之后</p></div>
      <div class="field">
        <label class="field-label">页脚链接（每行一个：名称 | URL）</label>
        <textarea class="textarea" id="s-links" placeholder="GitHub | https://github.com/...">${(s.footerLinks || []).map((l) => `${l.label} | ${l.url}`).join("\n")}</textarea>
        <p class="hint">格式：显示名称，竖线，链接地址。邮箱可用 mailto:you@example.com</p>
      </div>
    </div>`;
}

function collectSiteView() {
  const links = el("s-links").value.split("\n").map((line) => {
    const [label, ...rest] = line.split("|");
    return { label: label.trim(), url: rest.join("|").trim() };
  }).filter((l) => l.label && l.url);
  return {
    name: el("s-name").value.trim(),
    author: el("s-author").value.trim(),
    tagline: el("s-tagline").value.trim(),
    description: el("s-description").value.trim(),
    avatar: el("s-avatar").value.trim(),
    email: el("s-email").value.trim(),
    github: el("s-github").value.trim(),
    footnote: el("s-footnote").value.trim(),
    footerLinks: links,
  };
}

/* ---------------- 分类管理视图 ---------------- */

function renderCategoriesView(c) {
  c.innerHTML = `
    <div class="card">
      <h3>文章分类</h3>
      <p class="card-desc">自定义分类名称与颜色，颜色会显示在筛选标签和文章标签上</p>
      <div id="cat-list">
        ${state.data.categories.map((cat, idx) => catRow(cat, idx)).join("")}
      </div>
      <button class="btn btn-ghost" id="add-cat" style="margin-top:16px">+ 添加分类</button>
    </div>`;

  el("add-cat").addEventListener("click", () => {
    const id = "cat-" + Date.now();
    state.data.categories.push({ id, name: "新分类", color: "#6b7280" });
    renderCategoriesView(c);
  });

  document.querySelectorAll(".cat-row").forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.querySelector(".cat-name-input").addEventListener("input", (e) => {
      state.data.categories[idx].name = e.target.value;
    });
    row.querySelector(".cat-color").addEventListener("input", (e) => {
      state.data.categories[idx].color = e.target.value;
    });
    row.querySelector(".icon-btn").addEventListener("click", () => {
      const removed = state.data.categories.splice(idx, 1)[0];
      state.data.posts.forEach((p) => {
        p.categoryIds = (p.categoryIds || []).filter((id) => id !== removed.id);
      });
      renderCategoriesView(c);
      showToast("分类已删除，记得保存");
    });
  });
}

function catRow(cat, idx) {
  return `
    <div class="cat-row" data-idx="${idx}">
      <input type="color" class="cat-color" value="${escapeHtml(cat.color || "#6b7280")}" title="选择颜色">
      <input class="cat-name-input" value="${escapeHtml(cat.name)}" placeholder="分类名称">
      <span class="cat-id">${escapeHtml(cat.id)}</span>
      <button class="icon-btn" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>`;
}

/* ---------------- 文章管理视图 ---------------- */

function renderPostsView(c) {
  const cats = state.data.categories;
  const sorted = [...state.data.posts].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  c.innerHTML = `
    <div class="posts-head">
      <div><h3>全部文章 <span style="color:var(--muted);font-weight:400">(${sorted.length})</span></h3></div>
      <button class="btn btn-primary" id="add-post">+ 写新文章</button>
    </div>
    <div id="post-list">
      ${sorted.map((p) => {
        const chips = (p.categoryIds || []).map((id) => {
          const cat = cats.find((x) => x.id === id);
          return cat ? `<span class="mini-chip" style="color:${escapeHtml(cat.color)}">${escapeHtml(cat.name)}</span>` : "";
        }).join("");
        return `
        <div class="post-row">
          <div class="post-row-info">
            <div class="post-row-title">${escapeHtml(p.title)}</div>
            <div class="post-row-meta"><span>${escapeHtml(p.date)}</span>${chips}<span>/${escapeHtml(p.slug)}</span></div>
          </div>
          <div class="post-row-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${escapeHtml(p.slug)}">编辑</button>
            <button class="btn btn-danger btn-sm" data-del="${escapeHtml(p.slug)}">删除</button>
          </div>
        </div>`;
      }).join("") || '<div class="card" style="text-align:center;color:var(--muted)">还没有文章，点击「写新文章」开始</div>'}
    </div>`;

  el("add-post").addEventListener("click", () => openEditor(null));
  document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("确定删除这篇文章吗？")) return;
    state.data.posts = state.data.posts.filter((p) => p.slug !== b.dataset.del);
    renderPostsView(c);
    showToast("文章已删除，记得保存");
  }));
}

/* ---------------- 文章编辑器 ---------------- */

function openEditor(slug) {
  const post = slug ? state.data.posts.find((p) => p.slug === slug) : null;
  state.editingSlug = slug;
  el("editor-title").textContent = post ? "编辑文章" : "写新文章";
  const cats = state.data.categories;
  el("editor-body").innerHTML = `
    <div class="row">
      <div class="field"><label class="field-label">标题</label><input class="input" id="e-title" value="${escapeHtml(post?.title || "")}" placeholder="文章标题"></div>
      <div class="field"><label class="field-label">日期</label><input class="input" type="date" id="e-date" value="${escapeHtml(post?.date || new Date().toISOString().slice(0,10))}"></div>
    </div>
    <div class="field"><label class="field-label">Slug（网址标识，留空自动生成）</label><input class="input" id="e-slug" value="${escapeHtml(post?.slug || "")}" placeholder="my-first-post"></div>
    <div class="field">
      <label class="field-label">分类（可多选）</label>
      <div class="cat-checks" id="e-cats">
        ${cats.map((cat) => {
          const selected = (post?.categoryIds || []).includes(cat.id);
          return `<label class="cat-check ${selected ? "selected" : ""}" data-catid="${escapeHtml(cat.id)}"><input type="checkbox" ${selected ? "checked" : ""}>${escapeHtml(cat.name)}</label>`;
        }).join("") || '<span class="hint">请先在「分类管理」添加分类</span>'}
      </div>
    </div>
    <div class="field"><label class="field-label">摘要</label><textarea class="textarea" id="e-excerpt" style="min-height:64px" placeholder="一两句话概括文章">${escapeHtml(post?.excerpt || "")}</textarea></div>

    <div class="field">
      <label class="field-label">封面图（可选）</label>
      <div class="upload-row">
        <input class="input" id="e-cover" value="${escapeHtml(post?.cover || "")}" placeholder="图片 URL 或上传">
        <input type="file" id="e-cover-file" accept="image/*" hidden>
        <button class="btn btn-ghost btn-sm" id="e-cover-upload">上传</button>
      </div>
      <img class="upload-preview ${post?.cover ? "show" : ""}" id="e-cover-preview" src="${escapeHtml(post?.cover || "")}" alt="">
    </div>

    <div class="field">
      <label class="field-label">正文</label>
      <div class="editor-toolbar">
        <button type="button" class="tool-btn" data-md="h2">H2</button>
        <button type="button" class="tool-btn" data-md="h3">H3</button>
        <button type="button" class="tool-btn" data-md="bold"><strong>B</strong></button>
        <button type="button" class="tool-btn" data-md="quote">引用</button>
        <button type="button" class="tool-btn" data-md="ul">列表</button>
        <button type="button" class="tool-btn" data-md="ol">有序</button>
        <button type="button" class="tool-btn" data-md="code">代码</button>
        <button type="button" class="tool-btn" data-md="link">链接</button>
        <button type="button" class="tool-btn" data-md="image">图片</button>
        <button type="button" class="tool-btn" data-md="player">播放器</button>
      </div>
      <textarea class="textarea editor-textarea" id="e-content" placeholder="支持 Markdown 语法...">${escapeHtml(post?.content || "")}</textarea>
      <div class="hint">图片语法：<code>![说明](图片URL)</code>　播放器：<code>{{player:链接}}</code></div>
      <div class="player-presets">
        <span class="hint" style="margin-right:4px">播放器快捷插入：</span>
        <button type="button" class="preset-btn" data-preset="bilibili">哔哩哔哩</button>
        <button type="button" class="preset-btn" data-preset="youtube">YouTube</button>
        <button type="button" class="preset-btn" data-preset="netease">网易云音乐</button>
        <button type="button" class="preset-btn" data-preset="audio">音频文件</button>
      </div>
    </div>`;

  // 分类勾选
  document.querySelectorAll("#e-cats .cat-check").forEach((label) => {
    const cb = label.querySelector("input");
    cb.addEventListener("change", () => label.classList.toggle("selected", cb.checked));
  });

  // 封面上传
  el("e-cover-upload").addEventListener("click", () => el("e-cover-file").click());
  el("e-cover-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast("正在上传封面...");
    try {
      const url = await uploadImage(file);
      el("e-cover").value = url;
      el("e-cover-preview").src = url;
      el("e-cover-preview").classList.add("show");
      showToast("封面上传成功", "success");
    } catch (err) { showToast("上传失败：" + err.message, "error"); }
  });
  el("e-cover").addEventListener("input", (e) => {
    const p = el("e-cover-preview");
    p.src = e.target.value;
    p.classList.toggle("show", !!e.target.value);
  });

  // 工具栏
  document.querySelectorAll(".tool-btn").forEach((b) => b.addEventListener("click", () => insertMarkdown(b.dataset.md)));
  document.querySelectorAll(".preset-btn").forEach((b) => b.addEventListener("click", () => {
    const type = b.dataset.preset;
    const tips = {
      bilibili: "粘贴 B 站视频链接，如 https://www.bilibili.com/video/BVxxxx",
      youtube: "粘贴 YouTube 链接",
      netease: "粘贴网易云音乐链接",
      audio: "粘贴音频文件直链，如 https://.../song.mp3",
    };
    const url = prompt(tips[type]);
    if (!url) return;
    const directive = type === "audio" ? `{{audio:${url}}}` : `{{player:${url}}}`;
    insertText("\n" + directive + "\n");
  }));

  el("editor-modal").hidden = false;
}

function insertText(text) {
  const ta = el("e-content");
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + text.length;
}

function insertMarkdown(kind) {
  const ta = el("e-content");
  const start = ta.selectionStart, end = ta.selectionEnd;
  const selected = ta.value.slice(start, end);
  const C = "\u0000"; // 光标哨兵，插入后定位到此处并移除
  let insert = "";
  switch (kind) {
    case "h2": insert = `\n## ${selected || C + "小标题"}\n`; break;
    case "h3": insert = `\n### ${selected || C + "小标题"}\n`; break;
    case "bold": insert = `**${selected || C + "粗体文字"}**`; break;
    case "quote": insert = `\n> ${selected || C + "引用内容"}\n`; break;
    case "ul": insert = `\n- ${selected || C + "列表项"}\n`; break;
    case "ol": insert = `\n1. ${selected || C + "列表项"}\n`; break;
    case "code": insert = `\n\`\`\`\n${selected || C + "代码"}\n\`\`\`\n`; break;
    case "link": insert = `[${selected || C + "链接文字"}](https://)`; break;
    case "image": {
      const url = prompt("输入图片 URL（也可以先用封面图的上传功能上传后复制 URL）");
      if (!url) return;
      insert = `\n![${selected || "图片说明"}](${url})\n` + C; break;
    }
    case "player": {
      const url = prompt("粘贴播放器链接（B站 / YouTube / 网易云 / 音频直链等）");
      if (!url) return;
      const isAudio = /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i.test(url);
      insert = `\n{{${isAudio ? "audio" : "player"}:${url}}}\n` + C; break;
    }
  }
  const cursorAbs = insert.indexOf(C) >= 0 ? start + insert.indexOf(C) : start + insert.length;
  const clean = insert.replace(/\u0000/g, "");
  ta.value = ta.value.slice(0, start) + clean + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = cursorAbs;
}

function saveEditor() {
  const title = el("e-title").value.trim();
  if (!title) { showToast("请输入标题", "error"); return; }
  let slug = el("e-slug").value.trim() || slugify(title);
  // slug 唯一性检查
  if (state.data.posts.some((p) => p.slug === slug && p.slug !== state.editingSlug)) {
    slug = slug + "-" + Date.now().toString().slice(-4);
  }
  const categoryIds = [...document.querySelectorAll("#e-cats .cat-check")]
    .filter((label) => label.querySelector("input").checked)
    .map((label) => label.dataset.catid);
  const post = {
    slug,
    title,
    date: el("e-date").value.trim(),
    categoryIds,
    excerpt: el("e-excerpt").value.trim(),
    cover: el("e-cover").value.trim(),
    content: el("e-content").value,
  };
  if (state.editingSlug) {
    const idx = state.data.posts.findIndex((p) => p.slug === state.editingSlug);
    state.data.posts[idx] = post;
  } else {
    state.data.posts.push(post);
  }
  el("editor-modal").hidden = true;
  renderPostsView(el("view-container"));
  showToast("文章已更新，点击右上角「保存更改」发布", "success");
}

el("editor-close")?.addEventListener("click", () => (el("editor-modal").hidden = true));
el("editor-cancel")?.addEventListener("click", () => (el("editor-modal").hidden = true));
el("editor-save")?.addEventListener("click", saveEditor);
el("editor-modal")?.addEventListener("click", (e) => { if (e.target === el("editor-modal")) el("editor-modal").hidden = true; });

/* ---------------- 保存 ---------------- */

el("save-btn")?.addEventListener("click", async () => {
  // 先收集当前视图的表单数据
  if (state.view === "site") state.data.site = collectSiteView();
  const btn = el("save-btn");
  btn.disabled = true;
  setSaveStatus("保存中...");
  try {
    await saveDataToGitHub();
    setSaveStatus("✓ 已保存并部署");
    showToast("保存成功，稍候片刻即可在前台看到更新", "success");
  } catch (err) {
    let msg = err.message;
    if (err.status === 403) msg = "保存失败：令牌权限不足，需要 Contents 读写";
    setSaveStatus("保存失败", true);
    showToast(msg, "error");
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- 启动 ---------------- */

(function init() {
  updateThemeIcon();
  // 清理旧版明文令牌，迁移到加密存储前的旧数据不再保留
  if (localStorage.getItem(LEGACY_TOKEN_KEY)) localStorage.removeItem(LEGACY_TOKEN_KEY);
  // 不再自动登录：每次进入页面都需要输入密码解锁，凭据只在内存中短期存在
  applyLoginMode();
})();
