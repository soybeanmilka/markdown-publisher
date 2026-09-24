const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "edge-extension", "content.js"), "utf8");

const context = {
  location: { hostname: "example.com", pathname: "/", href: "https://example.com/" },
  document: {
    querySelectorAll: () => [],
    getElementById: () => null,
    documentElement: { appendChild() {} }
  },
  chrome: {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async () => ({ ok: false })
    }
  },
  sessionStorage: { getItem: () => null, setItem() {} },
  setTimeout,
  clearInterval,
  setInterval
};

assert.doesNotThrow(
  () => vm.runInNewContext(source, context, { filename: "content.js" }),
  "content.js 在旧 manifest 只加载单文件时也必须能启动"
);

const ownerDocument = {
  body: null,
  defaultView: {
    frameElement: null,
    getComputedStyle: () => ({ display: "block", visibility: "visible" })
  }
};
const visibleElement = {
  ownerDocument,
  getClientRects: () => [{ width: 100, height: 20 }]
};
assert.strictEqual(
  context.isVisible(visibleElement),
  true,
  "扫描普通可见元素时不应因 ownerDocument 变量缺失而崩溃"
);

function fakeDocument(frames = []) {
  return {
    querySelectorAll(selector) { return selector === "iframe" ? frames : []; },
    defaultView: { frameElement: null, getComputedStyle: () => ({ display: "block", visibility: "visible" }) }
  };
}
const deepest = fakeDocument();
const middle = fakeDocument([{ contentDocument: deepest }]);
const root = fakeDocument([{ contentDocument: middle }]);
context.document = root;
assert.strictEqual(
  context.documentsToSearch().length,
  3,
  "微信公众号新版编辑器位于嵌套 iframe 时也应被扫描"
);

const titleElement = { id: "title" };
const bodyElement = { id: "body" };
context.document = {
  querySelectorAll(selector) { return selector === "[contenteditable='true']" ? [titleElement, bodyElement] : []; },
  defaultView: { frameElement: null, getComputedStyle: () => ({ display: "block", visibility: "visible" }) }
};
titleElement.ownerDocument = context.document;
bodyElement.ownerDocument = context.document;
titleElement.getClientRects = bodyElement.getClientRects = () => [{ width: 100, height: 20 }];
assert.strictEqual(
  context.findFirst(["[contenteditable='true']"], false, titleElement),
  bodyElement,
  "正文扫描不得再次选中 contenteditable 标题"
);

console.log("content bootstrap test passed");
