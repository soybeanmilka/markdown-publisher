const { Plugin, Modal, Notice, PluginSettingTab, Setting, normalizePath } = require("obsidian");
const http = require("http");
const { shell } = require("electron");

const DEFAULT_SETTINGS = { outputFolder: "10-准备发布/投稿包", bridgePort: 27124 };
const PAYLOAD_LIFETIME_MS = 10 * 60 * 1000;

const PLATFORMS = [
  ["微信公众号", "https://mp.weixin.qq.com/"],
  ["小红书", "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"],
  ["知乎", "https://zhuanlan.zhihu.com/write"],
  ["B站专栏", "https://member.bilibili.com/platform/upload/text"]
];

module.exports = class MultiPlatformPublisher extends Plugin {
  async onload() {
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

  async generate(file, openAll = false) {
    const raw = await this.app.vault.read(file);
    const article = cleanMarkdown(raw);
    const title = titleFrom(article, file.basename);
    const body = removeLeadingTitle(article);
    const summary = summaryFrom(article);
    const date = new Date().toISOString().slice(0, 10);
    const folder = normalizePath(`${this.settings.outputFolder}/${safeName(title)}-${date}`);
    await ensureFolder(this.app.vault, folder);

    const files = [
      ["标题.txt", title],
      ["公众号.html", markdownToWechatHtml(body, title)],
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
      bodyHtml: markdownToRichHtml(body),
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
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target).trim() + "\n";
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
function inline(value) {
  const code = [];
  let html = escapeHtml(value).replace(/`([^`]+)`/g, (_, text) => {
    const token = `\u0000CODE${code.length}\u0000`;
    code.push(`<code>${text}</code>`);
    return token;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => `<a href="${safeUrl(url)}">${label}</a>`)
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
function markdownToWechatHtml(markdown, title) {
  const body = markdownToRichHtml(markdown);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{max-width:720px;margin:32px auto;padding:0 20px;font:16px/1.9 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#374151}h1{font-size:26px}h2{margin-top:32px;font-size:21px}h3{font-size:18px}blockquote{margin:16px 0;padding:10px 14px;border-left:4px solid #07c160;background:#f6ffed}code{background:#f3f4f6;padding:2px 4px;border-radius:3px}pre{padding:14px;overflow:auto;background:#1f2937;color:#f9fafb;border-radius:6px}pre code{background:transparent}li{margin-left:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:8px;text-align:left}</style><body>${body}</body></html>`;
}
function assistantHtml(title, summary, article) { return `<!doctype html><meta charset="utf-8"><title>投稿助手</title><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p><p>打开一个平台，粘贴已复制的正文，检查后手动发布。</p><textarea id="article" style="width:95%;height:55vh">${escapeHtml(article)}</textarea><p>${PLATFORMS.map(([name, url]) => `<button onclick="navigator.clipboard.writeText(document.getElementById('article').value);window.open('${url}','_blank')">复制并打开${name}</button>`).join(" ")}</p>`; }
function checklist(title, summary) { return `# 发布清单：${title}\n\n## 摘要\n\n${summary}\n\n## 最后检查\n\n- [ ] 平台标题长度和敏感词\n- [ ] 封面、图片、代码块、公式\n- [ ] 外链、引用和原创声明\n- [ ] 内容已核对，确认后再点击发布\n\n> 本插件不登录账号、不保存密钥，也不会自动点击发布。\n`; }
