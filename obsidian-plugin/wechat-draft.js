// 微信公众号官方草稿 API 客户端。
// 实现思路参考 MIT 项目 DavidLam-oss/obsidian-wechat-converter，代码为本项目独立精简实现。

function responseJson(response) {
  if (response && typeof response.json === "object" && response.json !== null) return response.json;
  if (typeof response?.text === "string" && response.text) return JSON.parse(response.text);
  return {};
}

function assertWechatResult(data, action, acceptedKeys = []) {
  if (acceptedKeys.some(key => typeof data[key] === "string" && data[key])) return data;
  if (data.errcode === 0 || data.errmsg === "ok") return data;
  throw new Error(`${action}失败：${data.errmsg || "未知错误"} (${data.errcode ?? "N/A"})`);
}

function dataUrlToAsset(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("只支持 PNG、JPEG、GIF 或 WebP 图片");
  const mime = match[1].toLowerCase();
  const extension = mime.includes("jpeg") ? "jpg" : mime.split("/")[1];
  return { mime, extension, bytes: Buffer.from(match[2], "base64") };
}

function multipartBody(asset, fieldName = "media") {
  const boundary = `----LocalPublisher${Math.random().toString(36).slice(2)}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="image.${asset.extension}"\r\nContent-Type: ${asset.mime}\r\n\r\n`,
    "utf8"
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([header, asset.bytes, footer]);
  return {
    boundary,
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  };
}

class WechatDraftClient {
  constructor({ appId, appSecret, request }) {
    this.appId = String(appId || "").trim();
    this.appSecret = String(appSecret || "").trim();
    this.request = request;
    this.accessToken = "";
    this.expiresAt = 0;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.expiresAt - 300000) return this.accessToken;
    if (!this.appId || !this.appSecret) throw new Error("请先配置微信公众号 AppID 和 AppSecret");
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`;
    const data = responseJson(await this.request({ url, method: "GET", throw: false }));
    assertWechatResult(data, "获取 access_token", ["access_token"]);
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + Number(data.expires_in || 7200) * 1000;
    return this.accessToken;
  }

  async upload(dataUrl, permanent) {
    const token = await this.getAccessToken();
    const asset = dataUrlToAsset(dataUrl);
    const multipart = multipartBody(asset);
    const endpoint = permanent ? "material/add_material" : "media/uploadimg";
    const type = permanent ? "&type=image" : "";
    const response = await this.request({
      url: `https://api.weixin.qq.com/cgi-bin/${endpoint}?access_token=${encodeURIComponent(token)}${type}`,
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` },
      body: multipart.body,
      throw: false
    });
    return assertWechatResult(responseJson(response), permanent ? "上传封面" : "上传正文图片", permanent ? ["media_id"] : ["url"]);
  }

  uploadCover(dataUrl) { return this.upload(dataUrl, true); }
  uploadContentImage(dataUrl) { return this.upload(dataUrl, false); }

  async createDraft(article) {
    const token = await this.getAccessToken();
    const response = await this.request({
      url: `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      contentType: "application/json",
      body: JSON.stringify({ articles: [article] }),
      throw: false
    });
    return assertWechatResult(responseJson(response), "创建草稿", ["media_id"]);
  }
}

function findDataImages(html) {
  const matches = String(html || "").match(/data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+/gi) || [];
  return [...new Set(matches)];
}

async function publishWechatDraft(client, { title, author = "", digest = "", html, sourceUrl = "" }) {
  const images = findDataImages(html);
  if (!images.length) throw new Error("微信草稿需要封面：请在文章中至少放一张本地图片");

  const cover = await client.uploadCover(images[0]);
  let content = String(html || "");
  for (const image of images) {
    const uploaded = await client.uploadContentImage(image);
    content = content.split(image).join(uploaded.url);
  }

  const draft = await client.createDraft({
    title: String(title || "").slice(0, 64),
    author: String(author || "").slice(0, 16),
    digest: String(digest || "").slice(0, 120),
    content,
    content_source_url: String(sourceUrl || ""),
    thumb_media_id: cover.media_id,
    need_open_comment: 0,
    only_fans_can_comment: 0
  });
  return { mediaId: draft.media_id, uploadedImages: images.length };
}

module.exports = { WechatDraftClient, publishWechatDraft, dataUrlToAsset, findDataImages };
