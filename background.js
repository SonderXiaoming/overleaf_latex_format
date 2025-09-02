chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "ofh-format",
        title: "Format LaTeX (Overleaf)",
        contexts: ["all"],
        documentUrlPatterns: ["https://www.overleaf.com/*"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "ofh-format" && tab && tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: "FORMAT" });
    }
});

// 快捷键
chrome.commands.onCommand.addListener((command) => {
    if (command === "format-current-tab") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const t = tabs[0];
            if (t && t.id != null && /^https:\/\/www\.overleaf\.com\//.test(t.url || "")) {
                chrome.tabs.sendMessage(t.id, { type: "FORMAT" });
            }
        });
    }
});