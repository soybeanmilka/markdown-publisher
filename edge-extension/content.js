const FALLBACK_PLATFORM_CONFIG = {
  "mp.weixin.qq.com": {
    name: "微信公众号", contentKind: "html",
    title: ["#title", "textarea[placeholder*='标题']", "input[placeholder*='标题']", "[contenteditable='true'][data-placeholder*='标题']", "[contenteditable='true'][aria-label*='标题']", ".appmsg_title [contenteditable='true']", "[class*='title'] [contenteditable='true']"],
    body: [".ProseMirror", ".edui-body-container", ".js_editor_area [contenteditable='true']", "body[contenteditable='true']", "[contenteditable='true'][data-placeholder*='正文']", "[contenteditable='true']"],
    entryActions: [{ text: "文章" }]
  },
  "creator.xiaohongshu.com": {
    name: "小红书", contentKind: "html",
    title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
    body: [".ProseMirror", "[contenteditable='true'][data-placeholder*='正文']", "[contenteditable='true']"],
    entryActions: [{ text: "新的创作" }, { text: "新建创作" }, { text: "新建长文" }]
  },
  "zhuanlan.zhihu.com": {
    name: "知乎", contentKind: "html",
    title: ["textarea[placeholder*='标题']", ".WriteIndex-titleInput textarea", "input[placeholder*='标题']"],
    body: [".public-DraftEditor-content", ".ProseMirror", "[contenteditable='true']"],
    entryActions: []
  },
  "mp.toutiao.com": {
    name: "今日头条", contentKind: "html",
    title: ["textarea[placeholder*='标题']", "input[placeholder*='标题']", "[contenteditable='true'][data-placeholder*='标题']"],
    body: [".ProseMirror", ".ql-editor", "[contenteditable='true'][data-placeholder*='正文']", "[contenteditable='true']"],
    entryActions: []
  },
  "member.bilibili.com": {
    name: "B站专栏", contentKind: "html",
    title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
    body: [".ProseMirror", ".ql-editor", "[contenteditable='true'][data-placeholder*='正文']", "[contenteditable='true']"],
    entryActions: [{ text: "新的创作" }, { text: "新建专栏" }]
  }
};

const platformApi = globalThis.LocalPublisherPlatforms || {
  PLATFORM_CONFIG: FALLBACK_PLATFORM_CONFIG,
  payloadContentFor(adapter, payload) {
    if (payload?.bodyHtml) return { kind: "html", value: String(payload.bodyHtml) };
    return { kind: "text", value: String(payload?.body || "") };
  }
};
const { PLATFORM_CONFIG, payloadContentFor } = platformApi;

function isVisible(element) {
  if (!element) return false;
  const ownerDocument = element.ownerDocument || document;
  const ownerWindow = ownerDocument.defaultView || window;
  const style = ownerWindow.getComputedStyle(element);
  const hasRect = element.getClientRects().length > 0;
  const frameVisible = ownerDocument.defaultView?.frameElement && isVisible(ownerDocument.defaultView.frameElement);
  return style.display !== "none" && style.visibility !== "hidden" && (hasRect || (element === ownerDocument.body && frameVisible));
}

function documentsToSearch() {
  const documents = [document];
  for (let index = 0; index < documents.length; index += 1) {
    const ownerDocument = documents[index];
    for (const frame of ownerDocument.querySelectorAll("iframe")) {
      try {
        if (frame.contentDocument && !documents.includes(frame.contentDocument)) documents.push(frame.contentDocument);
      } catch (_) { /* 跨域 iframe 无法操作，保留手动粘贴兜底。 */ }
    }
  }
  return documents;
}

function findFirst(selectors, allowHidden = false, excludedElement = null) {
  for (const ownerDocument of documentsToSearch()) {
    for (const selector of selectors) {
      const elements = [...ownerDocument.querySelectorAll(selector)];
      const candidates = elements.filter(element => element !== excludedElement);
      const element = candidates.find(isVisible) || (allowHidden ? candidates[0] : null);
      if (element) return element;
    }
  }
  return null;
}

function dispatchEditorEvents(element, inputType, data) {
  const ownerWindow = element.ownerDocument.defaultView;
  try {
    element.dispatchEvent(new ownerWindow.InputEvent("input", { bubbles: true, inputType, data }));
  } catch (_) {
    element.dispatchEvent(new ownerWindow.Event("input", { bubbles: true }));
  }
  element.dispatchEvent(new ownerWindow.Event("change", { bubbles: true }));
}

function replaceEditableContent(element, value, kind) {
  const ownerDocument = element.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  element.focus();
  const selection = ownerWindow.getSelection();
  const range = ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  const command = kind === "html" ? "insertHTML" : "insertText";
  const inserted = ownerDocument.execCommand(command, false, value);
  if (!inserted) {
    let pasted = false;
    if (kind === "html") {
      try {
        const transfer = new ownerWindow.DataTransfer();
        const plain = ownerDocument.createElement("div");
        plain.innerHTML = value;
        transfer.setData("text/html", value);
        transfer.setData("text/plain", plain.textContent || "");
        const before = element.innerHTML;
        element.dispatchEvent(new ownerWindow.ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
        pasted = element.innerHTML !== before;
      } catch (_) { /* 某些页面不允许构造 ClipboardEvent，继续使用 DOM 兜底。 */ }
    }
    if (!pasted) {
      if (kind === "html") element.innerHTML = value;
      else element.textContent = value;
      dispatchEditorEvents(element, kind === "html" ? "insertFromPaste" : "insertText", kind === "html" ? null : value);
    }
  } else {
    dispatchEditorEvents(element, kind === "html" ? "insertFromPaste" : "insertText", kind === "html" ? null : value);
  }
  element.blur();
}

function setFormValue(element, value, kind = "text") {
  const ownerWindow = element.ownerDocument.defaultView;
  if (element.isContentEditable || element.getAttribute("contenteditable") === "true") {
    replaceEditableContent(element, value, kind);
    return;
  }

  element.focus();
  const prototype = element.tagName === "TEXTAREA"
    ? ownerWindow.HTMLTextAreaElement.prototype
    : ownerWindow.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value); else element.value = value;
  dispatchEditorEvents(element, "insertText", value);
  element.blur();
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function findClickableByText(text) {
  const wanted = normalizeText(text);
  const exact = [];
  const partial = [];
  for (const ownerDocument of documentsToSearch()) {
    const candidates = ownerDocument.querySelectorAll("button, a, [role='button'], [role='link'], [tabindex], [class*='card'], [class*='item']");
    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      const actual = normalizeText(candidate.innerText || candidate.textContent);
      if (!actual) continue;
      if (actual === wanted) exact.push(candidate);
      else if (actual.length <= wanted.length + 8 && actual.includes(wanted)) partial.push(candidate);
    }
  }
  return exact[0] || partial[0] || null;
}

function tryEnterEditor(adapter, payload) {
  if (!adapter.entryActions?.length) return false;
  const marker = `local-publisher-entry-${payload.createdAt}-${location.hostname}-${location.pathname}`;
  if (sessionStorage.getItem(marker)) return false;
  for (const action of adapter.entryActions) {
    const element = findClickableByText(action.text);
    if (!element) continue;
    sessionStorage.setItem(marker, action.text);
    element.click();
    showResult(`正在进入${adapter.name}创作页…`);
    return true;
  }
  return false;
}

function showResult(message, isError = false) {
  document.getElementById("local-publisher-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "local-publisher-toast";
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647",
    padding: "12px 16px", borderRadius: "8px", color: "white",
    background: isError ? "#b42318" : "#16794b", boxShadow: "0 6px 20px #0003",
    font: "14px/1.5 system-ui, sans-serif"
  });
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

let fillTimer = null;

function tryFill(payload) {
  const adapter = PLATFORM_CONFIG[location.hostname];
  if (!adapter) return false;
  const key = `local-publisher-filled-${payload.createdAt}-${location.hostname}`;
  if (sessionStorage.getItem(key)) return true;

  const titleElement = findFirst(adapter.title);
  const bodyContent = payloadContentFor(adapter, payload);
  const bodyElement = findFirst(adapter.body, bodyContent.kind === "markdown", titleElement);
  if (!titleElement || !bodyElement) {
    tryEnterEditor(adapter, payload);
    return false;
  }

  setFormValue(titleElement, payload.title, "text");
  setFormValue(bodyElement, bodyContent.value, bodyContent.kind);
  sessionStorage.setItem(key, "filled");
  showResult(`${adapter.name}的标题和正文已填入，请检查格式、图片和封面后再发布。`);
  return true;
}

function waitForEditor(payload, manual) {
  if (fillTimer) clearInterval(fillTimer);
  if (tryFill(payload)) return;
  if (manual) showResult("已连接 Obsidian，正在等待创作编辑器出现…");

  const deadline = Math.min(payload.expiresAt || Date.now() + 600000, Date.now() + 600000);
  fillTimer = setInterval(() => {
    if (tryFill(payload)) {
      clearInterval(fillTimer);
      fillTimer = null;
    } else if (Date.now() >= deadline) {
      clearInterval(fillTimer);
      fillTimer = null;
      if (manual) showResult("等待编辑器超时，请重新生成投稿包后再试。", true);
    }
  }, 800);
}

async function fillFromObsidian(manual = false) {
  const adapter = PLATFORM_CONFIG[location.hostname];
  if (!adapter) return;
  const result = await chrome.runtime.sendMessage({ type: "GET_PAYLOAD" });
  if (!result?.ok) {
    if (manual) showResult(result?.error || "无法连接 Obsidian", true);
    return;
  }
  if (adapter.redirectTo && location.href !== adapter.redirectTo) {
    location.replace(adapter.redirectTo);
    return;
  }
  waitForEditor(result.payload, manual);
}

chrome.runtime.onMessage.addListener(message => {
  if (message.type === "FILL_CURRENT_PAGE") fillFromObsidian(true);
});

fillFromObsidian();
