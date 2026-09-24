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

console.log("content bootstrap test passed");
