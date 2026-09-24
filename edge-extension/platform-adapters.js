(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LocalPublisherPlatforms = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PLATFORM_CONFIG = {
    "mp.weixin.qq.com": {
      name: "微信公众号",
      url: "https://mp.weixin.qq.com/",
      contentKind: "html",
      title: ["#title", "textarea[placeholder*='标题']", "input[placeholder*='标题']"],
      body: [".ProseMirror", ".edui-body-container", "body[contenteditable='true']", "[contenteditable='true'][data-placeholder*='正文']", "[contenteditable='true']"],
      entryActions: [{ text: "文章" }]
    },
    "creator.xiaohongshu.com": {
      name: "小红书",
      url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
      contentKind: "html",
      title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
      body: [".ProseMirror", "[contenteditable='true'][data-placeholder*='正文']", "[contenteditable='true']"],
      entryActions: [{ text: "新的创作" }, { text: "新建创作" }, { text: "新建长文" }]
    },
    "zhuanlan.zhihu.com": {
      name: "知乎",
      url: "https://zhuanlan.zhihu.com/write",
      contentKind: "html",
      title: ["textarea[placeholder*='标题']", ".WriteIndex-titleInput textarea", "input[placeholder*='标题']"],
      body: [".public-DraftEditor-content", ".ProseMirror", "[contenteditable='true']"],
      entryActions: []
    },
    "member.bilibili.com": {
      name: "B站专栏",
      url: "https://member.bilibili.com/platform/upload/text",
      contentKind: "html",
      title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
      body: [".ProseMirror", ".ql-editor", "[contenteditable='true'][data-placeholder*='正文']", "[contenteditable='true']"],
      entryActions: [{ text: "新的创作" }, { text: "新建专栏" }]
    },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function safeUrl(value) {
    const url = String(value || "").trim();
    return /^(https?:|mailto:)/i.test(url) ? escapeHtml(url) : "#";
  }

  function inlineMarkdown(value) {
    const codeTokens = [];
    let html = escapeHtml(value).replace(/`([^`]+)`/g, (_, code) => {
      const token = `\u0000CODE${codeTokens.length}\u0000`;
      codeTokens.push(`<code>${code}</code>`);
      return token;
    });
    html = html
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, url) => `<a href="${safeUrl(url)}">${label}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    return html.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeTokens[Number(index)] || "");
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function tableCells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  }

  function markdownToRichHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const output = [];
    let index = 0;
    let listType = "";
    const closeList = () => {
      if (listType) output.push(`</${listType}>`);
      listType = "";
    };

    while (index < lines.length) {
      const line = lines[index];
      const fence = line.match(/^```\s*([\w+-]*)\s*$/);
      if (fence) {
        closeList();
        const code = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index += 1;
        const language = fence[1] ? ` data-language="${escapeHtml(fence[1])}"` : "";
        output.push(`<pre${language}><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
        closeList();
        const headers = tableCells(line);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
          rows.push(tableCells(lines[index]));
          index += 1;
        }
        output.push(`<table><thead><tr>${headers.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        const wanted = unordered ? "ul" : "ol";
        if (listType !== wanted) {
          closeList();
          output.push(`<${wanted}>`);
          listType = wanted;
        }
        output.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
        index += 1;
        continue;
      }

      closeList();
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      else if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) output.push("<hr>");
      else if (line.trim()) output.push(`<p>${inlineMarkdown(line.trim())}</p>`);
      index += 1;
    }
    closeList();
    return output.join("\n");
  }

  function payloadContentFor(adapter, payload) {
    const kind = adapter?.contentKind === "markdown" ? "markdown" : "html";
    if (kind === "markdown") return { kind, value: String(payload?.body || "") };
    return { kind, value: String(payload?.bodyHtml || markdownToRichHtml(payload?.body || "")) };
  }

  return { PLATFORM_CONFIG, escapeHtml, markdownToRichHtml, payloadContentFor };
});
