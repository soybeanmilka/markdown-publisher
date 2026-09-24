const assert = require("assert");
const http = require("http");
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

function request(port, origin, bridgeRequest = false) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (origin) headers.Origin = origin;
    if (bridgeRequest) headers["X-Local-Publisher-Bridge"] = "edge-extension-v1";
    const req = http.request({ hostname: "127.0.0.1", port, path: "/payload", headers }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const plugin = new PublisherPlugin();
  plugin.settings = { bridgePort: 0 };
  plugin.currentPayload = { title: "测试标题", body: "测试正文", createdAt: Date.now(), expiresAt: Date.now() + 60000 };
  plugin.startBridge();
  await new Promise(resolve => plugin.bridgeServer.once("listening", resolve));
  const port = plugin.bridgeServer.address().port;
  try {
    const unauthenticated = await request(port);
    assert.strictEqual(unauthenticated.status, 403);

    const withoutOrigin = await request(port, undefined, true);
    assert.strictEqual(withoutOrigin.status, 200);

    const opaqueOrigin = await request(port, "null", true);
    assert.strictEqual(opaqueOrigin.status, 200);

    const forbidden = await request(port, "https://example.com", true);
    assert.strictEqual(forbidden.status, 403);

    const allowed = await request(port, "chrome-extension://test-extension", true);
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(JSON.parse(allowed.body).title, "测试标题");
    assert.strictEqual(allowed.headers["access-control-allow-origin"], "chrome-extension://test-extension");

    plugin.currentPayload.expiresAt = Date.now() - 1;
    const expired = await request(port, "chrome-extension://test-extension", true);
    assert.strictEqual(expired.status, 404);
  } finally {
    await new Promise(resolve => plugin.bridgeServer.close(resolve));
  }
  console.log("bridge smoke test passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
