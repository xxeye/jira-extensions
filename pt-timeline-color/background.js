// background.js — 擴充功能載入 / 更新時，自動重整所有 Atlassian 分頁
// 用途：避免開發者 reload 擴充後，已開著的 Jira 分頁裡的舊 content script 變孤兒
// （那些孤兒會丟一堆 "Cannot read properties of undefined (reading 'sync')" 錯誤）
//
// ─── 開發者 debug 時 ───
// 如果你正在追 bug、想保留 DevTools 狀態 / 觀察 stale content script 行為，
// 把下面 AUTO_RELOAD 改成 false 再 reload 擴充功能，就不會自動重整分頁了。
const AUTO_RELOAD = true;

chrome.runtime.onInstalled.addListener(() => {
  if (!AUTO_RELOAD) return;
  chrome.tabs.query({ url: 'https://*.atlassian.net/*' }, (tabs) => {
    for (const tab of tabs) chrome.tabs.reload(tab.id);
  });
});
