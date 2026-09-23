const PAGES = [
  "https://mp.weixin.qq.com/",
  "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
  "https://zhuanlan.zhihu.com/write",
  "https://member.bilibili.com/platform/upload/text/apply",
  "https://mp.csdn.net/mp_blog/creation/editor"
];

async function refresh() {
  const status = document.getElementById("status");
  const result = await chrome.runtime.sendMessage({ type: "GET_PAYLOAD" });
  if (result?.ok) {
    status.textContent = "已连接，文章在 10 分钟内可用";
    status.className = "ok";
    document.getElementById("title").textContent = result.payload.title;
  } else {
    status.textContent = result?.error || "无法连接 Obsidian";
    status.className = "error";
  }
}

document.getElementById("fill").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: "FILL_CURRENT_PAGE" }); window.close(); }
  catch (_) { document.getElementById("status").textContent = "当前页面不是已支持的创作页"; }
};

document.getElementById("open-all").onclick = async () => {
  for (const url of PAGES) await chrome.tabs.create({ url, active: false });
  window.close();
};

document.getElementById("save-port").onclick = async () => {
  const bridgePort = Number.parseInt(document.getElementById("port").value, 10);
  if (bridgePort >= 1024 && bridgePort <= 65535) await chrome.storage.local.set({ bridgePort });
  refresh();
};

chrome.storage.local.get({ bridgePort: 27124 }).then(({ bridgePort }) => { document.getElementById("port").value = bridgePort; });
refresh();
