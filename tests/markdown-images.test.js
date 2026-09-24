const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      Plugin: EmptyClass,
      Modal: EmptyClass,
      Notice: EmptyClass,
      PluginSettingTab: EmptyClass,
      Setting: EmptyClass,
      normalizePath: value => value
    };
  }
  if (request === "electron") return { shell: { openExternal: async () => {} } };
  return originalLoad.call(this, request, parent, isMain);
};

const PublisherPlugin = require("../obsidian-plugin/main.js");
Module._load = originalLoad;

const { cleanMarkdown, resolveObsidianImages, markdownToRichHtml } = PublisherPlugin._test || {};
assert.strictEqual(typeof cleanMarkdown, "function", "插件应暴露 Markdown 清洗函数用于回归测试");
assert.strictEqual(typeof markdownToRichHtml, "function", "插件应暴露富文本转换函数用于回归测试");

const cleaned = cleanMarkdown("# 标题\n\n正文\n\n![[Pasted image 20260924140856.png]]\n");
assert.ok(!cleaned.includes("!Pasted image"), "Obsidian 图片不能退化为截图中的 !文件名 文本");
assert.ok(cleaned.includes("![Pasted image 20260924140856.png](Pasted%20image%2020260924140856.png)"), "Obsidian 图片应保留为标准 Markdown 图片");

const rich = markdownToRichHtml("第一段\n\n![截图](data:image/png;base64,QUJD)\n\n最后一段");
assert.ok(rich.includes("<p>第一段</p>"));
assert.ok(rich.includes('<img src="data:image/png;base64,QUJD" alt="截图">'), "富文本应生成真正的图片节点");
assert.ok(rich.includes("<p>最后一段</p>"), "图片不能吞掉知乎文章的后续段落");
assert.ok(!rich.includes("!截图"));

async function main() {
  const sourceFile = { path: "00-收件箱/文章.md" };
  const asset = { path: "90-系统/附件/截图.png", extension: "png" };
  const app = {
    metadataCache: { getFirstLinkpathDest: target => target === "截图.png" ? asset : null },
    vault: { readBinary: async file => file === asset ? Buffer.from("PNG") : null }
  };
  const resolved = await resolveObsidianImages(app, "正文\n\n![[截图.png]]", sourceFile);
  assert.ok(resolved.includes("![截图.png](data:image/png;base64,UE5H)"), "应从 Obsidian 附件读取本地图片并嵌入投稿载荷");
  console.log("markdown image test passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
