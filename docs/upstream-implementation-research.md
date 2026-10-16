# 上游实现与复用边界核查

核查日期：2026-09-24。范围仅限用户指定的两个 GitHub 仓库、其源码/README/LICENSE 与微信官方文档。结论针对 `markdown-publisher`，不把网页逆向接口、导出 Cookie 或自动点击发布视为合规接入。

## 先给结论

可以把发布器做成“本地 Markdown 适配 + 人工提交”，并可从 `obsidian-wechat-converter` 借鉴或（遵守 MIT 通知后）复用其渲染和图片预处理代码。**不要复制 `ai-writing-plugins` 的实现**：仓库已迁移到 `Agentchengfeng/ai-writing-plugins`，当前根目录和插件目录均没有 `LICENSE`，没有明确授权就只可研究思路。

公众号官方草稿 API 对个人主体不是通用方案：个人主体账号自 2025-07 起被回收相关发布能力。其他平台的“自动存草稿”在第二个仓库里不是官方 API，而是另装浏览器扩展使用浏览器已有登录态；它的本地桥接协议可学习，但不应作为本项目的默认/核心功能。

## 1. 许可证与可复用边界

| 上游 | 证据 | 允许的复用方式 | 不应做的事 |
| --- | --- | --- | --- |
| [`Ceeon/ai-writing-plugins`（现重定向为 `Agentchengfeng/ai-writing-plugins`）](https://github.com/Agentchengfeng/ai-writing-plugins) | 根目录列出两个插件和 README，但没有 `LICENSE` 文件；仓库树见[根目录](https://github.com/Agentchengfeng/ai-writing-plugins)。 | 只借鉴架构和效果描述；自己从零实现。 | 不复制/改写其 `converter.js`、`main.js`、CSS 或内嵌第三方压缩库。无许可证不等于开源许可；GitHub 的[许可证说明](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-a-license-to-a-repository)也说明，开放许可才会授权使用、修改和分发。 |
| [`DavidLam-oss/obsidian-wechat-converter`](https://github.com/DavidLam-oss/obsidian-wechat-converter) | 仓库 [LICENSE](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/LICENSE) 是 MIT。 | 可复制、修改、合并、发布其代码/CSS；所有“实质部分”副本要保留原 MIT 版权与许可文本。更适合先抽取小而独立的实现并带 `THIRD_PARTY_NOTICES.md`。 | 不把“MIT”理解成平台授权：调用平台/浏览器登录态仍须遵守平台规则；其 npm 依赖、素材或独立扩展有各自许可证，不能仅靠此仓库的 MIT 一并授权。 |

`ai-writing-plugins` README 只描述“Apple Style 排版 + PicGo 上传”，没有授予再分发许可；其使用 PicGo 本地 HTTP 服务（默认 `127.0.0.1:36677/upload`）的配置描述见[README](https://github.com/Agentchengfeng/ai-writing-plugins)。Apple Style 的 [`converter.js`](https://github.com/Agentchengfeng/ai-writing-plugins/blob/main/obsidian-apple-style/converter.js) 用 `markdown-it` 生成内联 CSS HTML、再以 `ClipboardItem` 写入 `text/html`；它不是微信 API/草稿同步，也没有 Mermaid 或 LaTeX/MathJax 的专门处理。图片插件的 [`main.js`](https://github.com/Agentchengfeng/ai-writing-plugins/blob/main/obsidian-image-auto-upload-plugin/main.js) 则上传图片并替换 Markdown 引用 URL。因此本项目可独立支持 PicGo 协议和富文本剪贴板导出，但不要搬运该项目源码。

## 2. 图片、Mermaid、LaTex 的实现链路

### 图片

`obsidian-wechat-converter` 的实现可拆成可复用的“资源管线”，而不是把 Base64 整段塞入文章：

1. 解析 Obsidian WikiLink、相对/绝对路径和远程 URL，收集为 Markdown 与 `assets[]`；相关实现位于 [`services/image-source-utils.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/image-source-utils.js) 和 [`services/article-image-assets.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/article-image-assets.js)。
2. 对微信目标，[`services/wechat-image-transcoder.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/wechat-image-transcoder.js) 使用浏览器 Canvas 转换不兼容格式；GIF 单独保留，避免动画被压成首帧。
3. [`services/wechat-api.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/wechat-api.js) 调用 `media/uploadimg` 得到正文图片 URL；封面则调用 `material/add_material` 获得永久 `media_id`。再把 HTML 中的图片地址替换为前者、将后者作为 `thumb_media_id`。

这很适合后续的公众号合格账号连接器。当前轻量发布器先只应输出图片清单/本地文件引用；等账号能力确认后再接第 3 步。

### Mermaid

源码 [`services/rendered-mermaid.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/rendered-mermaid.js) 接收 Obsidian/Mermaid 渲染出来的 SVG，内联样式、扁平化 `foreignObject` 标签，再由 [`services/svg-rasterizer.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/svg-rasterizer.js) 栅格化为 PNG data URL。README 明确说明公众号草稿同步时 Mermaid 转 PNG，以规避超长 SVG/平台清洗问题。[源码入口](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/rendered-mermaid.js)和[说明](https://github.com/DavidLam-oss/obsidian-wechat-converter#-mermaid-%E5%9B%BE%E8%A1%A8%E6%94%AF%E6%8C%81)相互印证。

可合法并入：将这一设计改写成发布器的“图表预处理器”，产出 PNG 文件并让正文引用该文件。不能假设所有平台都需要 PNG：知乎/CSDN 的 Markdown 渲染能力不同，应保留原 Mermaid 源码或提供目标平台开关。

### LaTeX

[`lib/math-entry.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/lib/math-entry.js) 注册 `markdown-it-mathjax3`，以 MathJax 生成 SVG；[`services/wechat-media.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/wechat-media.js) 遍历 SVG、把它 Canvas 化为 PNG、上传并用 `<img>` 替换。其 [`services/wechat-sync.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/wechat-sync.js) 在提交草稿前检查残留 `svg`/`mjx-container`，避免公式被微信清洗。

可合法并入：复用或重写“MathJax SVG → PNG → 目标图片上传”的接口形状。注意 `markdown-it-mathjax3`/MathJax 是外部依赖，若将它们的代码或构建产物一起发行，必须同时核对并保留各自许可，而不是仅复制该仓库的 MIT LICENSE。

## 3. 微信官方草稿同步的真实链路与账号限制

上游的 [`services/wechat-api.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/wechat-api.js) 实现的请求顺序与微信官方 API 一致：

```text
AppID + AppSecret
  → /cgi-bin/token（缓存 access_token）
  → /cgi-bin/media/uploadimg（每张正文图片）
  → /cgi-bin/material/add_material?type=image（封面永久素材）
  → /cgi-bin/draft/add（HTML articles[] + thumb_media_id）
  → 返回 media_id，缓存“笔记路径 ↔ 草稿 media_id”
  → 后续同步：/cgi-bin/draft/update；否则继续 draft/add
```

- 官方[新增草稿](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add)要求服务端调用；正文是 HTML，图片需要可访问的微信素材 URL，封面需要永久素材 ID。上游的本地图片解析、转码、逐张上传、再建草稿设计是正确的工程拆分。
- 如果要“真正发布”，还要使用官方[提交发布](https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_submit)和[查询发布状态](https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_get)；仅有 `draft/add` 只是进入草稿箱。
- 最关键的边界来自官方[发布能力说明](https://developers.weixin.qq.com/doc/service/guide/product/publish.html)：自 2025-07 起个人主体、未认证企业主体和不能认证账号的相关权限会被回收。因此这个项目不能向个人学习号承诺 API 草稿/自动发布；产品上要先做账号能力检测，默认仍是 HTML 复制与人工后台提交。
- AppSecret 不能留在 Obsidian 插件前端、同步到网盘或 Git。若未来接入，使用本机受控后台/系统凭据库；本项目的 `.gitignore` 应覆盖所有实际密钥配置。

## 4. 其它平台“浏览器登录态”的实际架构

这不是 Obsidian 直接读取 Cookie。上游 README 说明知乎、掘金、CSDN、小红书等通过单独的“Obsidian 发布助手”浏览器扩展保存草稿，扩展使用浏览器已有登录态，Obsidian 不内嵌登录页；见[发布能力说明](https://github.com/DavidLam-oss/obsidian-wechat-converter#-wechat-converter)（“其他内容平台”段落）。

其可见源码显示的桥接结构是：

```text
Obsidian 插件
  ── WebSocket/HTTP（默认 127.0.0.1:9527）──> 浏览器扩展
  ── 在已登录的目标站点上下文执行保存草稿 ──> 目标平台
  <── 任务 ID、草稿链接、单平台结果 ──
```

- [`services/wechatsync-constants.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/wechatsync-constants.js)将默认端口固定为 `9527`，默认只绑定 `127.0.0.1`。
- [`services/wechatsync-bridge.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/services/wechatsync-bridge.js)用 WebSocket 握手、连接令牌哈希、首次配对、Origin 白名单和客户端数量上限管理连接；并把文章的 `title`、Markdown、HTML、`assets[]`、封面与任务请求传给扩展。
- [`views/publish-modal/multi-platform.js`](https://github.com/DavidLam-oss/obsidian-wechat-converter/blob/main/views/publish-modal/multi-platform.js)显示任务排队、重试、草稿链接和配额策略。README 也显示该链路存在免费/Pro 能力判断，不能把它当作本项目的免费基础设施。

结论：可以借鉴“本地回环绑定 + 令牌 + 明确配对 + 只发送结构化资产 + 返回可点击草稿链接”这一安全设计。**不能**在没有该浏览器扩展源码、许可证和各平台书面/官方授权的前提下，复制其目标站点自动化行为；也不应导入用户 Cookie、token 或规避该扩展的许可/配额控制。

## 5. 对 `markdown-publisher` 的合法实施清单

### 可以现在做

- 从零实现：平台适配 Markdown/HTML、标题/摘要/标签/封面建议、图片清单、投稿检查清单和“打开创作中心”链接。
- 从 MIT 上游**带版权通知地**抽取/改写：本地图片解析、SVG/公式/Mermaid 转 PNG 的处理管线，以及“资产数组而不是文章内 Base64”的传输格式。
- 为将来官方授权 API 预留 `PublisherConnector` 接口；只有经能力检测的公众号账号启用微信实现，失败时降级为导出包。

### 暂不应并入

- `ai-writing-plugins` 任意源码、样式或压缩依赖；先获得作者的明确书面许可证再考虑。
- 面向小红书、知乎、CSDN、B 站专栏的浏览器自动存草稿/点击发布：本次核查没有从这些平台获得普通作者可用的发布 API 授权，也没有审计到浏览器扩展目标平台适配器的授权与合规边界。
- 微信个人主体“自动同步草稿/自动发布”的宣传或默认按钮。

### 推荐最小路线

先交付一个可验证的输出层：同一 Markdown 生成微信 HTML、知乎/CSDN Markdown、小红书图文脚本和 B 站视频口播稿。等用户拥有符合资格的企业认证公众号，单独添加本机服务端的“图片上传 → 草稿”连接器；对其它平台继续坚持“生成 → 打开创作页 → 用户检查并提交”。

## 6. 用户提供的 Obsidian Publisher 0.3.0 构建包

对 `obsidian-publisher-latest.zip` 做了只读静态检查。压缩包没有发现可复用许可证，核心 Adapter 是 Vite 压缩产物，因此不复制其中代码。其 manifest 与运行时代码能确认以下通用架构：

- 权限包括 `cookies`、`scripting`、`tabs`、`declarativeNetRequest`、`downloads` 和广泛的站点访问权限。
- 每个平台不是共用一套 DOM 填充：Adapter 会检查登录 Cookie、建立临时请求头规则、打开隐藏标签页、调用平台接口上传图片并保存草稿。
- 图片先解析成结构化资产，以平台维度限并发、缓存上传结果、失败重试，并在最终结果中校验正文和图片数量。
- 今日头条和 X 需要专门的页面上下文脚本；这说明复杂编辑器仅靠通用 `contenteditable` 选择器不够稳定。

这些设计可作为独立实现的参考，但扩大 Cookie 与站点权限会提高账号安全和平台风控风险。本项目应按平台逐个增加权限与测试，不照搬“访问所有 HTTP/HTTPS 站点”的权限范围。
