const assert = require("assert");
const { WechatDraftClient, publishWechatDraft } = require("../obsidian-plugin/wechat-draft.js");

async function main() {
  const requests = [];
  const request = async options => {
    requests.push(options);
    if (options.url.includes("/cgi-bin/token")) return { json: { access_token: "TOKEN", expires_in: 7200 } };
    if (options.url.includes("/material/add_material")) return { json: { media_id: "COVER_ID" } };
    if (options.url.includes("/media/uploadimg")) return { json: { url: `https://mmbiz.qpic.cn/body-${requests.length}.png` } };
    if (options.url.includes("/draft/add")) return { json: { media_id: "DRAFT_ID" } };
    throw new Error(`unexpected request: ${options.url}`);
  };
  const client = new WechatDraftClient({ appId: "APP", appSecret: "SECRET", request });
  const html = '<p>正文</p><img src="data:image/png;base64,UE5H" alt="截图">';
  const result = await publishWechatDraft(client, {
    title: "测试文章",
    author: "豆浆",
    digest: "测试摘要",
    html
  });

  assert.strictEqual(result.mediaId, "DRAFT_ID");
  assert.ok(requests.some(item => item.url.includes("/material/add_material")), "首图应上传为永久封面素材");
  assert.ok(requests.some(item => item.url.includes("/media/uploadimg")), "正文图片应上传到微信图床");
  const draftRequest = requests.find(item => item.url.includes("/draft/add"));
  const article = JSON.parse(draftRequest.body).articles[0];
  assert.strictEqual(article.thumb_media_id, "COVER_ID");
  assert.ok(article.content.includes("https://mmbiz.qpic.cn/"));
  assert.ok(!article.content.includes("data:image"), "草稿正文不能残留 data URL");
  assert.ok(!draftRequest.url.includes("SECRET"), "AppSecret 不能进入草稿接口 URL");

  console.log("wechat draft test passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
