// messenger.js (isolated world)

// 向主世界发 RPC 请求
let _id = 1;
const pending = new Map();
function callPage(type, payload) {
    const id = _id++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.postMessage({ from: "ofh-content", type, id, payload }, "*");
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error("page timeout"));
            }
        }, 15000);
    });
}

// 接主世界回包
window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || msg.from !== "ofh-page") return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error));
    else waiter.resolve(msg.payload);
});

// 接 background / action / commands / contextMenus
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "__PING__") { sendResponse({ ok: true }); return; }

    if (msg?.type === "FORMAT") {
        (async () => {
            try {
                const res = await callPage("OFH_REQ_FORMAT");
                sendResponse({ ok: true, res });
            } catch (e) {
                sendResponse({ ok: false, error: String(e) });
            }
        })();
        return true;
    }

    if (msg?.type === "SYNC_ENV") {
        (async () => {
            try {
                const res = await callPage("OFH_REQ_SYNC_ENV");
                sendResponse({ ok: true, res });
            } catch (e) {
                sendResponse({ ok: false, error: String(e) });
            }
        })();
        return true;
    }
});
