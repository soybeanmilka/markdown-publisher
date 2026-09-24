const assert = require("assert");
const fs = require("fs");
const path = require("path");

const entryPath = path.join(__dirname, "..", "obsidian-plugin", "main.js");
const source = fs.readFileSync(entryPath, "utf8");

// Obsidian evaluates main.js with its own loader. A module-scope relative
// require is resolved from Obsidian itself rather than this plugin directory.
const moduleScopePrefix = source.slice(0, source.indexOf("module.exports = class"));
assert.doesNotMatch(
  moduleScopePrefix,
  /require\(["']\.\//,
  "Obsidian plugin entry must not use a module-scope relative require"
);

assert.match(
  source,
  /adapter\.getFullPath\([\s\S]*wechat-draft\.js/,
  "helper module should be resolved from the real plugin installation directory"
);

console.log("plugin entry load test passed");
