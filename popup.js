/* Simplified Settings Popup Script */

document.addEventListener('DOMContentLoaded', () => {
  const extensionEnabledInput = document.getElementById('extension-enabled');
  const openOptionsBtn = document.getElementById('open-options-btn');

  // Load existing activation status
  chrome.storage.local.get(['extensionEnabled'], (items) => {
    // Default to true if not explicitly set to false
    extensionEnabledInput.checked = items.extensionEnabled !== false;
  });

  // Save changes dynamically when toggled
  extensionEnabledInput.addEventListener('change', () => {
    const extensionEnabled = extensionEnabledInput.checked;
    
    chrome.storage.local.set({ extensionEnabled }, () => {
      // Notify active polymarket pages to reload their configuration/activation state
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.url && tab.url.includes('polymarket.com')) {
            chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
          }
        }
      });
    });
  });

  // Open Options Dashboard page
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }
});
