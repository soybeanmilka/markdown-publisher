const ADAPTERS = {
  "mp.weixin.qq.com": {
    title: ["#title", "textarea[placeholder*='标题']", "input[placeholder*='标题']"],
    body: [".ProseMirror", ".edui-body-container", "[contenteditable='true'][data-placeholder*='正文']", "[contenteditable='true']"]
  },
  "creator.xiaohongshu.com": {
    title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
    body: [".ProseMirror", "textarea[placeholder*='正文']", "[contenteditable='true']"]
  },
  "zhuanlan.zhihu.com": {
    title: ["textarea[placeholder*='标题']", ".WriteIndex-titleInput textarea", "input[placeholder*='标题']"],
    body: [".public-DraftEditor-content", ".ProseMirror", "[contenteditable='true']"]
  },
  "member.bilibili.com": {
    title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
    body: [".ProseMirror", "textarea[placeholder*='正文']", "[contenteditable='true']"]
  },
  "mp.csdn.net": {
    title: ["#txtTitle", "input.article-bar__title", "textarea[placeholder*='标题']", "input[placeholder*='标题']"],
    body: ["#editor", ".ProseMirror", ".ql-editor", "textarea[placeholder*='正文']", "[contenteditable='true']"]
  }
};

function isVisible(element) {
  if (!element) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function findFirst(selectors) {
  for (const selector of selectors) {
    const element = [...document.querySelectorAll(selector)].find(isVisible);
    if (element) return element;
  }
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      for (const selector of selectors) {
        const element = [...frame.contentDocument.querySelectorAll(selector)].find(isVisible);
        if (element) return element;
      }
    } catch (_) { /* 跨域 iframe 不能直接操作，交给复制粘贴兜底。 */ }
  }
  return null;
}

function setFormValue(element, value) {
  const ownerDocument = element.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  element.focus();
  if (element.isContentEditable) {
    const selection = ownerWindow.getSelection();
    const range = ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = ownerDocument.execCommand("insertText", false, value);
    if (!inserted) {
      element.textContent = value;
      element.dispatchEvent(new ownerWindow.InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
  } else {
    const prototype = element.tagName === "TEXTAREA" ? ownerWindow.HTMLTextAreaElement.prototype : ownerWindow.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new ownerWindow.Event("input", { bubbles: true }));
    element.dispatchEvent(new ownerWindow.Event("change", { bubbles: true }));
  }
  element.blur();
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
  const adapter = ADAPTERS[location.hostname];
  if (!adapter) return false;
  const key = `local-publisher-${payload.createdAt}-${location.pathname}`;
  if (sessionStorage.getItem(key)) return true;
  const titleElement = findFirst(adapter.title);
  const bodyElement = findFirst(adapter.body);
  if (!titleElement || !bodyElement) return false;
  setFormValue(titleElement, payload.title);
  setFormValue(bodyElement, payload.body);
  sessionStorage.setItem(key, "filled");
  showResult("标题和正文已自动填入，请检查格式、图片和封面后再发布。");
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
  const adapter = ADAPTERS[location.hostname];
  if (!adapter) return;
  const result = await chrome.runtime.sendMessage({ type: "GET_PAYLOAD" });
  if (!result?.ok) {
    if (manual) showResult(result?.error || "无法连接 Obsidian", true);
    return;
  }

  waitForEditor(result.payload, manual);
}

chrome.runtime.onMessage.addListener(message => {
  if (message.type === "FILL_CURRENT_PAGE") fillFromObsidian(true);
});

fillFromObsidian();
