export default defineBackground(() => {
  // Sync settings to all content scripts on install
  browser.runtime.onInstalled.addListener(() => {
    browser.storage.sync.set({ mode: 'strict', overrides: {}, scrubCount: 0 });
  });

  // Clean up tab-specific state on close
  browser.tabs.onRemoved.addListener((_tabId) => {
    // No persistent per-tab state in current MVP — mappings are in-memory in content script
  });
});
