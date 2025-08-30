chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "formatSelection",
        title: "Format LaTeX (Overleaf)",
        contexts: ["all"],
        documentUrlPatterns: ["https://www.overleaf.com/*"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    const action = info.menuItemId === "formatSelection" ? "FORMAT" : "null";
    await chrome.tabs.sendMessage(tab.id, { type: action });
});

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: "FORMAT" });
});

// 从快捷键命令转发
chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (command === "format-document") {
        await chrome.tabs.sendMessage(tab.id, { type: "FORMAT" });
    }
});
