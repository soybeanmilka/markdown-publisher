const DEFAULT_PORT = 27124;

async function getBridgePort() {
  const { bridgePort } = await chrome.storage.local.get({ bridgePort: DEFAULT_PORT });
  return bridgePort;
}

async function getPayload() {
  const port = await getBridgePort();
  const response = await fetch(`http://127.0.0.1:${port}/payload`, { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 404 ? "请先在 Obsidian 生成投稿包" : `桥接请求失败：${response.status}`);
  return response.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GET_PAYLOAD") return false;
  getPayload().then(payload => sendResponse({ ok: true, payload })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
