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

console.log("content bootstrap test passed");
