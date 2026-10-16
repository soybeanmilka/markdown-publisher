const { Plugin, Modal, Notice, PluginSettingTab, Setting, normalizePath, MarkdownRenderer, requestUrl } = require("obsidian");
const http = require("http");
const { shell } = require("electron");
let WechatDraftClient;
let publishWechatDraft;

const DEFAULT_SETTINGS = {
  outputFolder: "10-准备发布/投稿包",
  bridgePort: 27124,
  wechatAppId: "",
  wechatAppSecret: "",
  wechatAuthor: "",
  wechatSourceUrl: ""
};
const PAYLOAD_LIFETIME_MS = 10 * 60 * 1000;

const PLATFORMS = [
  ["微信公众号", "https://mp.weixin.qq.com/"],
  ["小红书", "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"],
  ["知乎", "https://zhuanlan.zhihu.com/write"],
  ["今日头条", "https://mp.toutiao.com/profile_v4/graphic/publish"],
  ["B站专栏", "https://member.bilibili.com/platform/upload/text"]
];

module.exports = class MultiPlatformPublisher extends Plugin {
  async onload() {
    // Obsidian's plugin loader does not resolve a module-scope relative require
    // from the plugin directory. Resolve the optional helper after the plugin
    // instance gives us its real installation directory.
    const helperPath = this.app.vault.adapter.getFullPath(normalizePath(`${this.manifest.dir}/wechat-draft.js`));
    ({ WechatDraftClient, publishWechatDraft } = require(helperPath));
    await this.loadSettings();
    this.currentPayload = null;
    this.startBridge();
    this.addCommand({
      id: "generate-publishing-package",
      name: "为当前笔记生成多平台投稿包",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) this.generate(file);
        return true;
      }
    });
    this.addCommand({
      id: "generate-and-open-all-platforms",
      name: "生成并自动填充全部平台",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) this.generate(file, true);
        return true;
      }
    });
    this.addCommand({
      id: "sync-current-note-to-wechat-draft",
      name: "同步当前笔记到微信公众号草稿箱",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) this.syncWechatDraft(file);
        return true;
      }
    });
    this.addRibbonIcon("send", "生成并自动填充全部平台", () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") return new Notice("请先打开一篇要投稿的 Markdown 笔记。");
      this.generate(file, true);
    });
    this.addSettingTab(new PublisherSettingTab(this.app, this));
  }

  onunload() {
    if (this.bridgeServer) this.bridgeServer.close();
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  async prepareArticle(file) {
    const raw = await this.app.vault.read(file);
    const article = cleanMarkdown(await resolveObsidianImages(this.app, raw, file));
    const title = titleFrom(article, file.basename);
    const body = removeLeadingTitle(article);
    const summary = summaryFrom(article);
    const bodyHtml = await renderPortableHtml(this.app, body, file, this);
    return { article, title, body, bodyHtml, summary };
  }

  async generate(file, openAll = false) {
    const { title, body, bodyHtml, summary } = await this.prepareArticle(file);
    const date = new Date().toISOString().slice(0, 10);
    const folder = normalizePath(`${this.settings.outputFolder}/${safeName(title)}-${date}`);
    await ensureFolder(this.app.vault, folder);

    const files = [
      ["标题.txt", title],
      ["公众号.html", wrapWechatHtml(bodyHtml, title)],
      ["知乎.md", body],
      ["小红书.md", body],
      ["B站专栏.md", body],
      ["投稿助手.html", assistantHtml(title, summary, body)],
      ["发布清单.md", checklist(title, summary)]
    ];
    for (const [name, content] of files) await upsert(this.app.vault, `${folder}/${name}`, content);
    this.currentPayload = {
      title,
      body,
      bodyHtml,
      summary,
      sourcePath: file.path,
      createdAt: Date.now(),
      expiresAt: Date.now() + PAYLOAD_LIFETIME_MS
    };
    if (openAll) {
      await Promise.allSettled(PLATFORMS.map(([, url]) => shell.openExternal(url)));
      new Notice("投稿包已生成，创作页正在打开；扩展会自动等待并填入内容。");
    } else {
      new Notice(`投稿包已生成：${folder}`);
      new PublishModal(this.app, title, body, folder).open();
    }
  }

  async syncWechatDraft(file) {
    if (!this.settings.wechatAppId || !this.settings.wechatAppSecret) {
      new Notice("请先在插件设置中填写微信公众号 AppID 和 AppSecret。");
      return;
    }
    try {
      new Notice("正在渲染文章并上传图片到微信公众号…");
      const article = await this.prepareArticle(file);
      const client = new WechatDraftClient({
        appId: this.settings.wechatAppId,
        appSecret: this.settings.wechatAppSecret,
        request: requestUrl
      });
      const result = await publishWechatDraft(client, {
        title: article.title,
        author: this.settings.wechatAuthor,
        digest: plainText(article.summary),
        html: article.bodyHtml,
        sourceUrl: this.settings.wechatSourceUrl
      });
      new Notice(`已写入微信公众号草稿箱：${result.uploadedImages} 张正文图片。请到后台检查后发布。`, 10000);
    } catch (error) {
      console.error("微信公众号草稿同步失败", error);
      new Notice(`微信公众号草稿同步失败：${error?.message || error}`, 12000);
    }
  }

  startBridge() {
    this.bridgeServer = http.createServer((request, response) => {
      const origin = request.headers.origin || "";
      const isExtensionOrigin = /^(chrome|edge)-extension:\/\//.test(origin);
      const allowedOrigin = isExtensionOrigin ? origin : "";
      const hasBridgeHeader = request.headers["x-local-publisher-bridge"] === "edge-extension-v1";
      if (allowedOrigin) {
        response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
        response.setHeader("Vary", "Origin");
      }
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Local-Publisher-Bridge");
      response.setHeader("Cache-Control", "no-store");
      if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }

      const address = request.socket.remoteAddress || "";
      const isLoopback = address === "127.0.0.1" || address === "::1" || address.endsWith(":127.0.0.1");
      const hasAllowedOrigin = !origin || origin === "null" || isExtensionOrigin;
      if (!isLoopback || !hasBridgeHeader || !hasAllowedOrigin || request.url !== "/payload") {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      if (!this.currentPayload || this.currentPayload.expiresAt < Date.now()) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "no-active-article" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(this.currentPayload));
    });
    this.bridgeServer.on("error", error => {
      console.error("多平台投稿助手桥接服务启动失败", error);
      new Notice(`浏览器桥接启动失败：端口 ${this.settings.bridgePort} 可能被占用。复制投稿仍可使用。`);
    });
    this.bridgeServer.listen(this.settings.bridgePort, "127.0.0.1");
  }
};

class PublisherSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl("h2", { text: "多平台投稿助手" });
    new Setting(containerEl).setName("投稿包目录").setDesc("相对于当前 Obsidian 库。生成的稿件都放在这里，不会修改原笔记。")
      .addText(text => text.setValue(this.plugin.settings.outputFolder).onChange(async value => {
        this.plugin.settings.outputFolder = value.trim() || DEFAULT_SETTINGS.outputFolder;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("浏览器桥接端口").setDesc("Edge 扩展只通过本机回环地址读取十分钟内生成的文章。修改后需重启 Obsidian。")
      .addText(text => text.setValue(String(this.plugin.settings.bridgePort)).onChange(async value => {
        const port = Number.parseInt(value, 10);
        if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
          this.plugin.settings.bridgePort = port;
          await this.plugin.saveSettings();
        }
      }));
    containerEl.createEl("h3", { text: "微信公众号官方草稿 API" });
    containerEl.createEl("p", { text: "只在执行“同步当前笔记到微信公众号草稿箱”时请求微信官方 API。公众号账号必须拥有相应接口权限，并把当前出口 IP 加入白名单。" });
    new Setting(containerEl).setName("AppID").addText(text => text
      .setValue(this.plugin.settings.wechatAppId)
      .onChange(async value => { this.plugin.settings.wechatAppId = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("AppSecret").setDesc("保存在本库插件 data.json 中，不会发送给其它平台。")
      .addText(text => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.wechatAppSecret).onChange(async value => {
          this.plugin.settings.wechatAppSecret = value.trim(); await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl).setName("作者名").addText(text => text
      .setValue(this.plugin.settings.wechatAuthor)
      .onChange(async value => { this.plugin.settings.wechatAuthor = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("原文链接（可选）").addText(text => text
      .setValue(this.plugin.settings.wechatSourceUrl)
      .onChange(async value => { this.plugin.settings.wechatSourceUrl = value.trim(); await this.plugin.saveSettings(); }));
  }
}

class PublishModal extends Modal {
  constructor(app, title, article, folder) { super(app); this.title = title; this.article = article; this.folder = folder; }
  onOpen() {
    const { contentEl } = this; contentEl.createEl("h2", { text: "投稿包已就绪" });
    contentEl.createEl("p", { text: `已保存到：${this.folder}` });
    contentEl.createEl("p", { text: "选择平台后会先复制正文，再打开对应的官方投稿页。请检查封面、图片、链接和格式后手动点击发布。" });
    const allButton = contentEl.createEl("button", { text: "打开全部平台并自动填充" });
    allButton.style.margin = "0 8px 8px 0";
    allButton.onclick = async () => {
      await Promise.allSettled(PLATFORMS.map(([, url]) => shell.openExternal(url)));
      this.close();
    };
    const titleButton = contentEl.createEl("button", { text: "复制标题" });
    titleButton.style.margin = "0 8px 8px 0";
    titleButton.onclick = async () => { await navigator.clipboard.writeText(this.title); new Notice("标题已复制。"); };
    for (const [name, url] of PLATFORMS) {
      const button = contentEl.createEl("button", { text: `复制正文并打开 ${name}` });
      button.style.margin = "0 8px 8px 0";
      button.onclick = async () => {
        try { await navigator.clipboard.writeText(this.article); new Notice("正文已复制，现在粘贴到投稿页即可。"); }
        catch (_) { new Notice("没有拿到剪贴板权限，请从生成的 Markdown 文件复制正文。"); }
        window.open(url, "_blank");
      };
    }
    contentEl.createEl("p", { text: "公众号请使用生成目录中的“公众号.html”：用浏览器打开后复制页面正文，样式保留得更好。" });
  }
  onClose() { this.contentEl.empty(); }
}

function cleanMarkdown(raw) {
  return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "")
    .replace(/!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => `![${label || target}](${encodeURI(target)})`)
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target).trim() + "\n";
}
async function resolveObsidianImages(app, markdown, sourceFile) {
  const pattern = /!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  const matches = [...markdown.matchAll(pattern)];
  let resolved = markdown;
  for (const match of matches) {
    const target = match[1].trim();
    const asset = app.metadataCache?.getFirstLinkpathDest(target, sourceFile.path);
    const extension = String(asset?.extension || target.split(".").pop() || "").toLowerCase();
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" }[extension];
    if (!asset || !mime) continue;
    try {
      const binary = await app.vault.readBinary(asset);
      const dataUrl = `data:${mime};base64,${Buffer.from(binary).toString("base64")}`;
      const alt = (match[2] || target).replace(/\]/g, "");
      resolved = resolved.replace(match[0], `![${alt}](${dataUrl})`);
    } catch (_) { /* 找不到图片时保留标准 Markdown 路径，方便用户发现并手动处理。 */ }
  }
  return resolved;
}
function titleFrom(text, fallback) { const match = text.match(/^#\s+(.+?)\s*$/m); return match ? match[1] : fallback; }
function removeLeadingTitle(text) { return text.replace(/^#\s+.+?\s*\n+/, ""); }
function summaryFrom(text) { const match = text.match(/^>\s*(.+?)\s*$/m); return match ? match[1] : "（从正文提炼一句摘要）"; }
function safeName(value) { return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60); }
async function ensureFolder(vault, folder) {
  const parts = folder.split("/"); let current = "";
  for (const part of parts) { current = current ? `${current}/${part}` : part; if (!vault.getAbstractFileByPath(current)) await vault.createFolder(current); }
}
async function upsert(vault, path, content) { const existing = vault.getAbstractFileByPath(path); if (existing) await vault.modify(existing, content); else await vault.create(path, content); }
function escapeHtml(value) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function safeUrl(value) { return /^(https?:|mailto:)/i.test(value) ? value.replace(/"/g, "&quot;") : "#"; }
function safeImageUrl(value) { return /^(https?:|data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,)/i.test(value) ? value.replace(/"/g, "&quot;") : "#"; }
function inline(value) {
  const code = [];
  let html = escapeHtml(value).replace(/`([^`]+)`/g, (_, text) => {
    const token = `\u0000CODE${code.length}\u0000`;
    code.push(`<code>${text}</code>`);
    return token;
  });
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => `<img src="${safeImageUrl(url)}" alt="${alt}">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => `<a href="${safeUrl(url)}">${label}</a>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>");
  return html.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)] || "");
}
function tableCells(line) { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim()); }
function isTableSeparator(line) { return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line); }
function markdownToRichHtml(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output = []; let index = 0; let list = "";
  const closeList = () => { if (list) output.push(`</${list}>`); list = ""; };
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      closeList(); const code = []; index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); continue;
    }
    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      closeList(); const headers = tableCells(line); const rows = []; index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(tableCells(lines[index++]));
      output.push(`<table><thead><tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { closeList(); const level = heading[1].length; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); index += 1; continue; }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/); const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const wanted = unordered ? "ul" : "ol"; if (list !== wanted) { closeList(); output.push(`<${wanted}>`); list = wanted; }
      output.push(`<li>${inline((unordered || ordered)[1])}</li>`); index += 1; continue;
    }
    closeList();
    if (/^>\s?/.test(line)) output.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
    else if (line.trim()) output.push(`<p>${inline(line.trim())}</p>`);
    index += 1;
  }
  closeList(); return output.join("\n");
}
function plainText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function rasterizeSvg(svg) {
  const ownerDocument = svg.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox?.baseVal;
  const width = Math.max(1, Math.ceil(rect.width || viewBox?.width || Number(svg.getAttribute("width")) || 800));
  const height = Math.max(1, Math.ceil(rect.height || viewBox?.height || Number(svg.getAttribute("height")) || 300));
  const xml = new ownerWindow.XMLSerializer().serializeToString(svg);
  const source = `data:image/svg+xml;base64,${Buffer.from(xml, "utf8").toString("base64")}`;
  const image = new ownerWindow.Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = source; });
  const scale = Math.min(2, 2400 / width, 2400 / height);
  const canvas = ownerDocument.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const replacement = ownerDocument.createElement("img");
  replacement.src = canvas.toDataURL("image/png");
  replacement.alt = svg.closest(".mermaid") ? "Mermaid 图表" : "数学公式";
  const blockMath = svg.closest("mjx-container")?.getAttribute("display") === "true";
  replacement.setAttribute("style", blockMath
    ? "display:block;max-width:100%;height:auto;margin:16px auto;"
    : "display:inline-block;max-width:100%;height:auto;vertical-align:middle;margin:0 2px;");
  const mermaid = svg.closest(".mermaid");
  const mathHost = svg.closest("mjx-container");
  if (mermaid) mermaid.replaceWith(replacement);
  else if (mathHost) mathHost.replaceWith(replacement);
  else svg.replaceWith(replacement);
}
function applyPortableStyles(container) {
  const styles = {
    h1: "font-size:26px;line-height:1.4;font-weight:700;margin:28px 0 16px;color:#111827;",
    h2: "font-size:22px;line-height:1.5;font-weight:700;margin:28px 0 14px;color:#111827;border-bottom:1px solid #e5e7eb;padding-bottom:6px;",
    h3: "font-size:18px;line-height:1.6;font-weight:700;margin:22px 0 10px;color:#1f2937;",
    p: "font-size:16px;line-height:1.9;margin:12px 0;color:#374151;",
    blockquote: "margin:16px 0;padding:10px 14px;border-left:4px solid #07c160;background:#f6ffed;color:#4b5563;",
    pre: "margin:16px 0;padding:14px;overflow:auto;background:#1f2937;color:#f9fafb;border-radius:6px;line-height:1.6;white-space:pre-wrap;",
    code: "font-family:Consolas,monospace;background:#f3f4f6;padding:2px 4px;border-radius:3px;",
    img: "display:block;max-width:100%;height:auto;margin:16px auto;",
    table: "border-collapse:collapse;width:100%;margin:16px 0;",
    th: "border:1px solid #d1d5db;padding:8px;text-align:left;background:#f9fafb;",
    td: "border:1px solid #d1d5db;padding:8px;text-align:left;",
    li: "font-size:16px;line-height:1.8;margin:4px 0;color:#374151;"
  };
  for (const [selector, style] of Object.entries(styles)) {
    for (const element of container.querySelectorAll(selector)) {
      const existing = element.getAttribute("style") || "";
      element.setAttribute("style", `${style}${existing}`);
    }
  }
  for (const code of container.querySelectorAll("pre code")) code.setAttribute("style", "background:transparent;padding:0;color:inherit;");
}
async function renderPortableHtml(app, markdown, sourceFile, component) {
  if (!MarkdownRenderer || typeof document === "undefined" || !document.body) return markdownToRichHtml(markdown);
  const container = document.createElement("div");
  Object.assign(container.style, { position: "fixed", left: "-10000px", top: "0", width: "760px", visibility: "hidden" });
  document.body.appendChild(container);
  try {
    await MarkdownRenderer.render(app, markdown, container, sourceFile.path, component);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const pending = [...container.querySelectorAll(".mermaid")].some(element => !element.querySelector("svg"));
      if (!pending) break;
      await delay(100);
    }
    for (const svg of [...container.querySelectorAll("svg")]) {
      try { await rasterizeSvg(svg); } catch (error) { console.warn("SVG 转 PNG 失败，将保留原始 SVG", error); }
    }
    applyPortableStyles(container);
    return container.innerHTML || markdownToRichHtml(markdown);
  } finally {
    container.remove();
  }
}
function wrapWechatHtml(body, title) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="max-width:720px;margin:32px auto;padding:0 20px;font-family:-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif;color:#374151;">${body}</body></html>`;
}
function markdownToWechatHtml(markdown, title) {
  const body = markdownToRichHtml(markdown);
  return wrapWechatHtml(body, title);
}
function assistantHtml(title, summary, article) { return `<!doctype html><meta charset="utf-8"><title>投稿助手</title><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p><p>打开一个平台，粘贴已复制的正文，检查后手动发布。</p><textarea id="article" style="width:95%;height:55vh">${escapeHtml(article)}</textarea><p>${PLATFORMS.map(([name, url]) => `<button onclick="navigator.clipboard.writeText(document.getElementById('article').value);window.open('${url}','_blank')">复制并打开${name}</button>`).join(" ")}</p>`; }
function checklist(title, summary) { return `# 发布清单：${title}\n\n## 摘要\n\n${summary}\n\n## 最后检查\n\n- [ ] 平台标题长度和敏感词\n- [ ] 封面、图片、代码块、公式\n- [ ] 外链、引用和原创声明\n- [ ] 内容已核对，确认后再点击发布\n\n> 本插件不登录账号、不保存密钥，也不会自动点击发布。\n`; }

module.exports._test = { cleanMarkdown, resolveObsidianImages, markdownToRichHtml, plainText, applyPortableStyles };
