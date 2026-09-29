// Service worker for Claude Exporter Pro

// Inject content script into already-open Claude.ai tabs on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          files: ['jszip.min.js', 'utils.js', 'content.js'],
        })
        .catch((err) =>
          console.log('Could not inject into tab', tab.id, err)
        );
    });
  });
});

// Handle requests to ensure content script is injected
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ensureContentScript') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting
          .executeScript({
            target: { tabId: tabs[0].id },
            files: ['jszip.min.js', 'utils.js', 'content.js'],
          })
          .then(() => sendResponse({ success: true }))
          .catch((err) =>
            sendResponse({ success: false, error: err.message })
          );
      }
    });
    return true; // Keep message channel open for async response
  }
});
