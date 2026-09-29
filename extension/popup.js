// ============================================================================
// Claude Exporter Pro — Popup Logic
// ============================================================================

let pageInfo = null;

// --- Helpers ---

function showStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.className = `status ${type}`;
  el.textContent = message;
  if (type === 'success') {
    setTimeout(() => { el.className = 'status'; }, 4000);
  }
}

async function sendToClaudeTab(action, data = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('claude.ai')) {
    throw new Error('Please navigate to a Claude.ai page first.');
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Request failed'));
      }
    });
  });
}

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  // Version
  const manifest = chrome.runtime.getManifest();
  document.getElementById('versionDisplay').textContent = `v${manifest.version}`;

  // Detect org and page context
  try {
    pageInfo = await sendToClaudeTab('getPageInfo');
    const orgDot = document.getElementById('orgDot');
    const orgText = document.getElementById('orgText');

    if (pageInfo.orgId) {
      orgDot.classList.remove('error');
      orgText.textContent = `Org: ${pageInfo.orgId.substring(0, 8)}...`;

      // Enable buttons based on context
      document.getElementById('exportAll').disabled = false;

      if (pageInfo.conversationId) {
        document.getElementById('exportCurrent').disabled = false;
      }
      if (pageInfo.projectId) {
        document.getElementById('exportProject').disabled = false;
      }
    } else {
      orgDot.classList.add('error');
      orgText.textContent = 'Could not detect organization. Log into Claude.ai.';
    }
  } catch (e) {
    document.getElementById('orgDot').classList.add('error');
    document.getElementById('orgText').textContent = 'Open a Claude.ai tab first';
  }
});

// --- Export Current Conversation ---

document.getElementById('exportCurrent').addEventListener('click', async () => {
  const btn = document.getElementById('exportCurrent');
  btn.disabled = true;
  showStatus('Exporting conversation...', 'info');

  try {
    const result = await sendToClaudeTab('exportConversation', {
      conversationId: pageInfo.conversationId,
      format: document.getElementById('format').value,
      extractArtifacts: document.getElementById('extractArtifacts').checked,
      branchOnly: document.getElementById('branchOnly').checked,
    });
    showStatus('Conversation exported!', 'success');
  } catch (e) {
    showStatus(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- Export Current Project ---

document.getElementById('exportProject').addEventListener('click', async () => {
  const btn = document.getElementById('exportProject');
  btn.disabled = true;
  showStatus('Exporting project... this may take a while', 'info');

  try {
    // Try to get project name from the page
    const projName = await sendToClaudeTab('getPageInfo').then((info) => {
      return 'project'; // Will be resolved by content.js
    });

    const result = await sendToClaudeTab('exportProject', {
      projectId: pageInfo.projectId,
      projectName: projName,
      branchOnly: document.getElementById('branchOnly').checked,
    });
    showStatus(`Exported ${result.count} conversations, ${result.artifacts} artifacts!`, 'success');
  } catch (e) {
    showStatus(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- Export All Grouped ---

document.getElementById('exportAll').addEventListener('click', async () => {
  const btn = document.getElementById('exportAll');
  btn.disabled = true;
  showStatus('Exporting all conversations grouped by project... this will take a while', 'info');

  try {
    const result = await sendToClaudeTab('exportAllGrouped', {
      branchOnly: document.getElementById('branchOnly').checked,
    });
    showStatus(
      `Exported ${result.count} conversations, ${result.artifacts} artifacts across ${result.projects} projects!`,
      'success'
    );
  } catch (e) {
    showStatus(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- Browse ---

document.getElementById('browseConversations').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('browse.html') });
});
