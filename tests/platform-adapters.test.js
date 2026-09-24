const assert = require("assert");
const {
  PLATFORM_CONFIG,
  markdownToRichHtml,
  payloadContentFor
} = require("../edge-extension/platform-adapters.js");

function main() {
  assert.strictEqual(
    PLATFORM_CONFIG["member.bilibili.com"].url,
    "https://member.bilibili.com/platform/upload/text"
  );
  assert.strictEqual(
    PLATFORM_CONFIG["creator.xiaohongshu.com"].url,
    "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
  );

  const markdown = [
    "## 小节",
    "",
    "这里有 **重点**、`代码` 和 [链接](https://example.com)。",
    "",
    "- 第一项",
    "- 第二项",
    "",
    "| 名称 | 说明 |",
    "| --- | --- |",
    "| RAII | 自动管理资源 |",
    "",
    "```cpp",
    "std::vector<int> values;",
    "```"
  ].join("\n");
  const html = markdownToRichHtml(markdown);
  assert.match(html, /<h2[^>]*>小节<\/h2>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<code[^>]*>代码<\/code>/);
  assert.match(html, /<ul[^>]*>[\s\S]*<li[^>]*>第一项<\/li>/);
  assert.match(html, /<table[^>]*>[\s\S]*RAII/);
  assert.match(html, /<pre[^>]*>[\s\S]*std::vector/);
  assert.doesNotMatch(html, /## 小节/);

  const payload = { body: markdown, bodyHtml: html };
  assert.strictEqual(payloadContentFor(PLATFORM_CONFIG["zhuanlan.zhihu.com"], payload).kind, "html");
  assert.strictEqual(payloadContentFor(PLATFORM_CONFIG["zhuanlan.zhihu.com"], payload).value, html);

  assert.ok(PLATFORM_CONFIG["mp.weixin.qq.com"].entryActions.some(action => action.text.includes("文章")));
  assert.ok(PLATFORM_CONFIG["mp.weixin.qq.com"].body.some(selector => selector.includes("contenteditable")));
  assert.ok(!Object.values(PLATFORM_CONFIG).some(adapter => /csdn/i.test(adapter.name || "")));
  assert.ok(PLATFORM_CONFIG["creator.xiaohongshu.com"].entryActions.some(action => action.text.includes("新的创作")));
  assert.ok(PLATFORM_CONFIG["member.bilibili.com"].entryActions.some(action => action.text.includes("新的创作")));

  console.log("platform adapter tests passed");
}

main();
