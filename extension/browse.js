// ============================================================================
// Claude Exporter Pro — Browse Page
// ============================================================================

// --- State ---
let allConversations = [];
let filteredConversations = [];
let allProjects = [];
let projectsMap = {};
let orgId = null;
let sortStack = [{ field: 'updated', direction: 'desc' }];
let selectedIds = new Set();
let cancelRequested = false;

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  orgId = await detectOrgId();
  if (!orgId) {
    showError('Could not detect Organization ID. Open a Claude.ai tab and make sure you are logged in.');
    return;
  }
  document.getElementById('orgBadge').textContent = `Org: ${orgId.substring(0, 8)}...`;
  await loadData();
  setupEventListeners();
});

async function detectOrgId() {
  // Try up to 2 times — first attempt might need content script injection
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sendToClaudeTab('getOrgId');
      if (response.orgId) return response.orgId;
    } catch (e) {
      console.warn(`Org detect attempt ${attempt + 1} failed:`, e.message);
      if (attempt === 0) {
        // Try injecting content script and retry
        await injectContentScript();
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  return null;
}

// Find a claude.ai tab — prefer the active one, fallback to any
function findClaudeTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tabs || tabs.length === 0) {
        reject(new Error('No Claude.ai tab found. Please open claude.ai in another tab and make sure you are logged in.'));
        return;
      }
      // Prefer active tab if it's claude.ai
      const active = tabs.find((t) => t.active);
      resolve(active || tabs[0]);
    });
  });
}

// Inject content script into the claude.ai tab if not already loaded
async function injectContentScript() {
  try {
    const tab = await findClaudeTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['jszip.min.js', 'utils.js', 'content.js'],
    });
    console.log('Content script injected into tab', tab.id);
  } catch (e) {
    console.warn('Could not inject content script:', e.message);
  }
}

async function sendToClaudeTab(action, data = {}) {
  const tab = await findClaudeTab();
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

// --- Data Loading ---

async function loadData() {
  try {
    const [convsResp, projResp] = await Promise.all([
      sendToClaudeTab('loadConversations', { orgId }),
      sendToClaudeTab('loadProjects', { orgId }),
    ]);

    allProjects = projResp.projects || [];
    projectsMap = {};
    allProjects.forEach((p) => {
      const id = p.uuid || p.id;
      projectsMap[id] = p.name || p.title || 'Untitled Project';
    });

    allConversations = (convsResp.conversations || []).map((conv) => ({
      ...conv,
      model: inferModel(conv),
    }));

    populateFilters();
    applyFiltersAndSort();
    // Enable "Export All Grouped" now that data is loaded
    document.getElementById('exportGroupedBtn').disabled = false;
  } catch (e) {
    console.error('Error loading data:', e);
    showError(`Failed to load conversations: ${e.message}`);
  }
}

function populateFilters() {
  // Project filter
  const projSelect = document.getElementById('projectFilter');
  const projNames = new Set();
  allConversations.forEach((c) => {
    const name = getProjectName(c);
    if (name !== '-') projNames.add(name);
  });
  [...projNames].sort().forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    projSelect.appendChild(opt);
  });

  // Model filter
  const modelSelect = document.getElementById('modelFilter');
  const models = new Set();
  allConversations.forEach((c) => {
    if (c.model) models.add(formatModelName(c.model));
  });
  [...models].sort().forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    modelSelect.appendChild(opt);
  });
}

// --- Filtering & Sorting ---

function getProjectName(conv) {
  const pid = conv.project_uuid || conv.project_id || conv.projectUuid;
  if (!pid) return '-';
  return projectsMap[pid] || '-';
}

function getModelBadgeClass(model) {
  if (!model) return '';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return '';
}

function applyFiltersAndSort() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const projFilter = document.getElementById('projectFilter').value;
  const modelFilter = document.getElementById('modelFilter').value;

  filteredConversations = allConversations.filter((c) => {
    if (search && !c.name?.toLowerCase().includes(search) && !(c.summary || '').toLowerCase().includes(search)) {
      return false;
    }
    if (projFilter && getProjectName(c) !== projFilter) return false;
    if (modelFilter && formatModelName(c.model) !== modelFilter) return false;
    return true;
  });

  sortConversations();
  displayConversations();
  updateStats();
}

function sortConversations() {
  filteredConversations.sort((a, b) => {
    for (const { field, direction } of sortStack) {
      let aVal, bVal;
      switch (field) {
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'project':
          aVal = getProjectName(a).toLowerCase();
          bVal = getProjectName(b).toLowerCase();
          break;
        case 'created':
          aVal = new Date(a.created_at);
          bVal = new Date(b.created_at);
          break;
        case 'updated':
          aVal = new Date(a.updated_at);
          bVal = new Date(b.updated_at);
          break;
        case 'model':
          aVal = formatModelName(a.model || '').toLowerCase();
          bVal = formatModelName(b.model || '').toLowerCase();
          break;
        default:
          continue;
      }
      let cmp = 0;
      if (aVal > bVal) cmp = 1;
      else if (aVal < bVal) cmp = -1;
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function handleColumnSort(field) {
  const idx = sortStack.findIndex((s) => s.field === field);
  if (idx === 0) {
    sortStack[0].direction = sortStack[0].direction === 'asc' ? 'desc' : 'asc';
  } else if (idx > 0) {
    const [item] = sortStack.splice(idx, 1);
    sortStack.unshift(item);
  } else {
    sortStack.unshift({ field, direction: 'asc' });
  }
  applyFiltersAndSort();
}

function getSortIndicator(field) {
  if (sortStack.length === 0 || sortStack[0].field !== field) return '';
  const dir = sortStack[0].direction;
  const primary = dir === 'asc' ? '\u2191' : '\u2193';
  const secondary = dir === 'asc' ? '\u2193' : '\u2191';
  return ` <span class="sort-indicator">${primary}<sub>${secondary}</sub></span>`;
}

// --- Display ---

function displayConversations() {
  const container = document.getElementById('tableContent');

  if (filteredConversations.length === 0) {
    container.innerHTML = '<div class="no-results">No conversations found</div>';
    return;
  }

  let html = `<table>
    <thead><tr>
      <th class="checkbox-col"><input type="checkbox" id="selectAll"></th>
      <th class="sortable" data-sort="name">Name${getSortIndicator('name')}</th>
      <th class="sortable" data-sort="project">Project${getSortIndicator('project')}</th>
      <th class="sortable" data-sort="updated">Updated${getSortIndicator('updated')}</th>
      <th class="sortable" data-sort="created">Created${getSortIndicator('created')}</th>
      <th class="sortable" data-sort="model">Model${getSortIndicator('model')}</th>
      <th>Actions</th>
    </tr></thead>
    <tbody>`;

  filteredConversations.forEach((conv) => {
    const updated = new Date(conv.updated_at).toLocaleDateString();
    const created = new Date(conv.created_at).toLocaleDateString();
    const model = formatModelName(conv.model || '');
    const badgeClass = getModelBadgeClass(conv.model || '');
    const project = escapeHtml(getProjectName(conv));
    const name = escapeHtml(conv.name || 'Untitled');
    const uuid = conv.uuid;
    const checked = selectedIds.has(uuid) ? 'checked' : '';

    html += `<tr data-id="${uuid}">
      <td class="checkbox-col"><input type="checkbox" class="row-check" value="${uuid}" ${checked}></td>
      <td class="conv-name"><a href="https://claude.ai/chat/${uuid}" target="_blank" title="${name}">${name}</a></td>
      <td>${project}</td>
      <td class="date">${updated}</td>
      <td class="date">${created}</td>
      <td><span class="model-badge ${badgeClass}">${escapeHtml(model)}</span></td>
      <td class="actions">
        <button class="btn-small primary export-single" data-id="${uuid}">Export</button>
        <a class="btn-small secondary" href="https://claude.ai/chat/${uuid}" target="_blank">View</a>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;

  // Attach table event listeners
  attachTableListeners();
}

function updateStats() {
  const total = allConversations.length;
  const shown = filteredConversations.length;
  const selected = selectedIds.size;
  let text = `${shown} of ${total} conversations`;
  if (selected > 0) text += ` | ${selected} selected`;
  document.getElementById('stats').textContent = text;
  document.getElementById('exportSelectedBtn').disabled = selected === 0;
}

function showError(msg) {
  document.getElementById('tableContent').innerHTML = `<div class="error-msg">${escapeHtml(msg)}</div>`;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- Event Listeners ---

function setupEventListeners() {
  // Search
  const searchInput = document.getElementById('searchInput');
  const searchBox = document.getElementById('searchBox');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchBox.classList.toggle('has-text', searchInput.value.length > 0);
    searchTimeout = setTimeout(applyFiltersAndSort, 200);
  });
  document.getElementById('clearSearch').addEventListener('click', () => {
    searchInput.value = '';
    searchBox.classList.remove('has-text');
    applyFiltersAndSort();
  });

  // Filters
  document.getElementById('projectFilter').addEventListener('change', applyFiltersAndSort);
  document.getElementById('modelFilter').addEventListener('change', applyFiltersAndSort);

  // Export selected
  document.getElementById('exportSelectedBtn').addEventListener('click', exportSelected);

  // Export all grouped by project
  document.getElementById('exportGroupedBtn').addEventListener('click', exportAllGroupedByProject);

  // Cancel export
  document.getElementById('cancelExport').addEventListener('click', () => {
    cancelRequested = true;
  });

  // --- Tabs ---
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // --- Artifacts search ---
  const artSearchInput = document.getElementById('artSearchInput');
  const artSearchBox = document.getElementById('artSearchBox');
  let artSearchTimeout;
  artSearchInput.addEventListener('input', () => {
    clearTimeout(artSearchTimeout);
    artSearchBox.classList.toggle('has-text', artSearchInput.value.length > 0);
    artSearchTimeout = setTimeout(applyFrameFilter, 200);
  });
  document.getElementById('artClearSearch').addEventListener('click', () => {
    artSearchInput.value = '';
    artSearchBox.classList.remove('has-text');
    applyFrameFilter();
  });

  document.getElementById('exportArtSelectedBtn').addEventListener('click', () => {
    exportFrames([...selectedFrameSlugs]);
  });
  document.getElementById('exportArtAllBtn').addEventListener('click', () => {
    exportFrames(filteredFrames.map((f) => f.slug));
  });
}

// ============================================================================
// Standalone Artifacts ("Artefactos")
// ============================================================================

let allFrames = [];
let filteredFrames = [];
let selectedFrameSlugs = new Set();
let framesLoaded = false;

function switchTab(tab) {
  const isArt = tab === 'artifacts';
  document.getElementById('tabConversations').classList.toggle('active', !isArt);
  document.getElementById('tabArtifacts').classList.toggle('active', isArt);
  document.getElementById('conversationsControls').style.display = isArt ? 'none' : '';
  document.getElementById('artifactsControls').style.display = isArt ? '' : 'none';
  document.getElementById('conversationsView').style.display = isArt ? 'none' : '';
  document.getElementById('artifactsView').style.display = isArt ? '' : 'none';
  if (isArt && !framesLoaded) loadFrames();
}

async function loadFrames() {
  framesLoaded = true;
  try {
    const resp = await sendToClaudeTab('loadFrames', { orgId });
    allFrames = (resp.frames || []).sort(
      (a, b) => new Date(b.updatedAt || b.updated_at || 0) - new Date(a.updatedAt || a.updated_at || 0)
    );
    applyFrameFilter();
  } catch (e) {
    console.error('Error loading artifacts:', e);
    document.getElementById('artTableContent').innerHTML =
      `<div class="error-msg">${escapeHtml('Failed to load artifacts: ' + e.message)}</div>`;
  }
}

function applyFrameFilter() {
  const search = document.getElementById('artSearchInput').value.toLowerCase();
  filteredFrames = allFrames.filter((f) => {
    if (!search) return true;
    return (
      (f.title || '').toLowerCase().includes(search) ||
      (f.description || '').toLowerCase().includes(search)
    );
  });
  displayFrames();
  updateFrameStats();
}

function displayFrames() {
  const container = document.getElementById('artTableContent');
  if (filteredFrames.length === 0) {
    container.innerHTML = '<div class="no-results">No artifacts found</div>';
    return;
  }

  let html = `<table>
    <thead><tr>
      <th class="checkbox-col"><input type="checkbox" id="artSelectAll"></th>
      <th>Title</th>
      <th>Description</th>
      <th>Owner</th>
      <th>Updated</th>
      <th>Actions</th>
    </tr></thead>
    <tbody>`;

  filteredFrames.forEach((f) => {
    const updated = f.updatedAt || f.updated_at;
    const updatedStr = updated ? new Date(updated).toLocaleDateString() : '-';
    const title = escapeHtml(`${f.favicon ? f.favicon + ' ' : ''}${f.title || 'Untitled'}`);
    const desc = escapeHtml(f.description || '');
    const owner = escapeHtml(f.owner_email || '');
    const url = `https://claude.ai/code/artifact/${f.slug}?org=${orgId}`;
    const checked = selectedFrameSlugs.has(f.slug) ? 'checked' : '';

    html += `<tr data-slug="${escapeHtml(f.slug)}">
      <td class="checkbox-col"><input type="checkbox" class="frame-check" value="${escapeHtml(f.slug)}" ${checked}></td>
      <td class="conv-name"><a href="${url}" target="_blank" title="${title}">${title}</a></td>
      <td class="art-desc" title="${desc}">${desc}</td>
      <td>${owner}</td>
      <td class="date">${updatedStr}</td>
      <td class="actions">
        <button class="btn-small primary export-frame" data-slug="${escapeHtml(f.slug)}">Export</button>
        <a class="btn-small secondary" href="${url}" target="_blank">View</a>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
  attachFrameListeners();
}

function updateFrameStats() {
  const total = allFrames.length;
  const shown = filteredFrames.length;
  const selected = selectedFrameSlugs.size;
  let text = `${shown} of ${total} artifacts`;
  if (selected > 0) text += ` | ${selected} selected`;
  document.getElementById('artStats').textContent = text;
  document.getElementById('exportArtSelectedBtn').disabled = selected === 0;
  document.getElementById('exportArtAllBtn').disabled = shown === 0;
}

function attachFrameListeners() {
  const selectAll = document.getElementById('artSelectAll');
  if (selectAll) {
    selectAll.checked =
      filteredFrames.length > 0 && filteredFrames.every((f) => selectedFrameSlugs.has(f.slug));
    selectAll.addEventListener('change', () => {
      filteredFrames.forEach((f) => {
        if (selectAll.checked) selectedFrameSlugs.add(f.slug);
        else selectedFrameSlugs.delete(f.slug);
      });
      displayFrames();
      updateFrameStats();
    });
  }

  document.querySelectorAll('.frame-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedFrameSlugs.add(cb.value);
      else selectedFrameSlugs.delete(cb.value);
      updateFrameStats();
      const sa = document.getElementById('artSelectAll');
      if (sa) {
        sa.checked =
          filteredFrames.length > 0 && filteredFrames.every((f) => selectedFrameSlugs.has(f.slug));
      }
    });
  });

  document.querySelectorAll('.export-frame').forEach((btn) => {
    btn.addEventListener('click', () => exportFrames([btn.dataset.slug]));
  });
}

// Reading is done inside the claude.ai tab (content.js), because the frame
// host's frame-ancestors CSP only allows embedding from claude.ai — not from
// this extension page. content.js mounts the hidden iframe there and returns
// both the metadata and the served HTML.
async function fetchFrameContent(slug) {
  return await sendToClaudeTab('fetchFrameContent', { orgId, slug });
}

async function exportFrames(slugs) {
  if (!slugs || slugs.length === 0) return;

  const total = slugs.length;
  const batchDelay = 500;
  cancelRequested = false;

  const modal = document.getElementById('progressModal');
  modal.querySelector('h3').textContent = 'Exporting Artifacts';
  modal.classList.add('show');
  updateProgress(0, total, 0, 0);

  const zip = new JSZip();
  const artFolder = zip.folder('artifacts');
  const indexEntries = [];
  let processed = 0;
  let ok = 0;
  let failed = 0;
  const usedNames = new Set();

  try {
    for (const slug of slugs) {
      if (cancelRequested) {
        showToast('Export cancelled');
        modal.classList.remove('show');
        return;
      }

      let resp = null;
      try {
        resp = await fetchFrameContent(slug);
      } catch (e) {
        // sendToClaudeTab rejects when content.js returns success:false
        failed++;
        processed++;
        console.error('Frame export failed for', slug, e.message);
        updateProgress(processed, total, ok, failed);
        document.getElementById('progressStats').textContent = `${failed} failed — last: ${e.message}`;
        continue;
      }

      const html = resp.html;
      const meta = resp.meta;
      if (!html) {
        failed++;
        processed++;
        console.error('Frame read empty for', slug, resp.method);
        updateProgress(processed, total, ok, failed);
        document.getElementById('progressStats').textContent = `${failed} failed — last: empty (${resp.method})`;
        continue;
      }

      // Unique filename per artifact
      let base = sanitizeFilename(meta.title || slug);
      let filename = `${base}.html`;
      let n = 2;
      while (usedNames.has(filename)) filename = `${base}_${n++}.html`;
      usedNames.add(filename);

      const header =
        `<!--\n` +
        `  Claude artifact export\n` +
        `  Title:   ${meta.title || ''}\n` +
        `  Slug:    ${slug}\n` +
        `  URL:     https://claude.ai/code/artifact/${slug}\n` +
        `  Author:  ${(meta.author && meta.author.email) || ''}\n` +
        `  Created: ${meta.created_at || ''}\n` +
        `  Updated: ${meta.updated_at || ''}\n` +
        `  Exported:${new Date().toISOString()}\n` +
        `-->\n`;
      artFolder.file(filename, header + html);

      indexEntries.push({
        title: meta.title || slug,
        file: `artifacts/${filename}`,
        slug,
        updated: meta.updated_at,
        created: meta.created_at,
      });

      ok++;
      processed++;
      updateProgress(processed, total, ok, failed);
      if (processed < total) await new Promise((r) => setTimeout(r, batchDelay));
    }

    // index.md
    const sorted = indexEntries.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
    let index = `# Claude Artifacts Export\n\n`;
    index += `| | |\n|---|---|\n`;
    index += `| **Exported** | ${new Date().toLocaleString()} |\n`;
    index += `| **Artifacts** | ${sorted.length} |\n\n---\n\n`;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      index += `### ${i + 1}. [${e.title}](./${e.file})\n`;
      const d = e.created ? new Date(e.created).toLocaleDateString() : '';
      index += `*${d} — [open in Claude](https://claude.ai/code/artifact/${e.slug})*\n\n`;
    }
    zip.file('index.md', index);

    updateProgressText(`Compressing ${sorted.length} artifacts...`);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => {
        if (meta.percent) updateProgressText(`Compressing... ${Math.round(meta.percent)}%`);
      }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude_artifacts_${getLocalDateTimeString()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
    document.getElementById('progressText').textContent = 'Complete!';
    document.getElementById('progressStats').textContent =
      `${ok} artifacts (${sizeMB} MB)` + (failed > 0 ? ` | ${failed} failed` : '');
    document.getElementById('progressBar').style.width = '100%';
    showToast(`Exported ${ok} artifacts!`);
    setTimeout(() => modal.classList.remove('show'), 3000);
  } catch (e) {
    document.getElementById('progressText').textContent = `Error: ${e.message}`;
    document.getElementById('progressStats').textContent = `${processed} of ${total} processed before error`;
    setTimeout(() => modal.classList.remove('show'), 5000);
  }
}

function attachTableListeners() {
  // Column sort
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => handleColumnSort(th.dataset.sort));
  });

  // Select all
  const selectAll = document.getElementById('selectAll');
  if (selectAll) {
    selectAll.checked = filteredConversations.length > 0 && filteredConversations.every((c) => selectedIds.has(c.uuid));
    selectAll.addEventListener('change', () => {
      filteredConversations.forEach((c) => {
        if (selectAll.checked) {
          selectedIds.add(c.uuid);
        } else {
          selectedIds.delete(c.uuid);
        }
      });
      displayConversations();
      updateStats();
    });
  }

  // Row checkboxes
  document.querySelectorAll('.row-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        selectedIds.add(cb.value);
      } else {
        selectedIds.delete(cb.value);
      }
      updateStats();
      // Update select-all state
      const sa = document.getElementById('selectAll');
      if (sa) {
        sa.checked = filteredConversations.length > 0 && filteredConversations.every((c) => selectedIds.has(c.uuid));
      }
    });
  });

  // Single export buttons
  document.querySelectorAll('.export-single').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await sendToClaudeTab('exportConversation', {
          conversationId: btn.dataset.id,
          orgId,
          format: 'markdown',
          extractArtifacts: true,
          branchOnly: true,
        });
        showToast('Exported!');
      } catch (e) {
        showToast(`Error: ${e.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Export';
      }
    });
  });
}

// --- Bulk Export ---
// Orchestrated from browse.js so we can update progress after each batch.
// content.js only fetches data; ZIP is built here where we have JSZip + utils.

async function exportSelected() {
  if (selectedIds.size === 0) return;

  const ids = [...selectedIds];
  const total = ids.length;
  const batchSize = 5;
  const batchDelay = 750;
  const branchOnly = true;
  cancelRequested = false;

  // Show progress modal
  const modal = document.getElementById('progressModal');
  modal.querySelector('h3').textContent = 'Exporting Conversations';
  modal.classList.add('show');
  updateProgress(0, total, 0, 0);

  const zip = new JSZip();
  const convFolder = zip.folder('conversations');
  const artFolder = zip.folder('artifacts');
  let artifactCount = 0;
  let processed = 0;
  let failed = 0;
  const indexEntries = [];

  try {
    for (let i = 0; i < total; i += batchSize) {
      if (cancelRequested) {
        showToast('Export cancelled');
        modal.classList.remove('show');
        return;
      }

      const batchIds = ids.slice(i, Math.min(i + batchSize, total));

      // Fetch this batch via content.js
      let batchResult;
      try {
        batchResult = await sendToClaudeTab('fetchConversationBatch', {
          conversationIds: batchIds,
          orgId,
        });
      } catch (e) {
        failed += batchIds.length;
        processed += batchIds.length;
        updateProgress(processed, total, artifactCount, failed);
        continue;
      }

      const conversations = batchResult.conversations || [];
      failed += batchIds.length - conversations.length;

      // Process each conversation locally (ZIP + artifacts)
      for (const { convId, data } of conversations) {
        const uuid8 = convId.substring(0, 8);
        const safeName = sanitizeFilename(data.name);
        const folderName = `${safeName}_${uuid8}`;
        const convFilename = `${folderName}.md`;

        // Extract artifacts using all 6 methods
        const artifacts = extractAllArtifacts(data, branchOnly);
        const artifactFiles = [];

        if (artifacts.size > 0) {
          const convArtFolder = artFolder.folder(folderName);
          for (const [id, art] of artifacts) {
            if (!art.content) continue;
            const artSafeName = sanitizeFilename(art.title || id);
            const ext = art.language ? getFileExtension(art.language) : getExtFromType(art.type);
            const artFilename = `${artSafeName}${ext}`;
            const backlink = `> Source: [${data.name || 'Untitled'}](../../conversations/${convFilename})\n\n---\n\n`;
            convArtFolder.file(artFilename, backlink + art.content);
            artifactFiles.push({ title: art.title || id, filename: artFilename });
            artifactCount++;
          }
        }

        // Write conversation markdown
        const md = conversationToMarkdown(data, data, artifactFiles, folderName, branchOnly);
        convFolder.file(convFilename, md);

        indexEntries.push({
          name: data.name || 'Untitled',
          file: `conversations/${convFilename}`,
          folder: folderName,
          created: data.created_at,
          updated: data.updated_at,
          model: data.model || 'unknown',
          artifactFiles,
        });
      }

      processed += batchIds.length;
      updateProgress(processed, total, artifactCount, failed);

      // Delay between batches to respect rate limits
      if (i + batchSize < total) {
        await new Promise((r) => setTimeout(r, batchDelay));
      }
    }

    // Generate index
    const sorted = indexEntries.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    let index = `# Export — ${sorted.length} Conversations\n\n`;
    index += `| | |\n|---|---|\n`;
    index += `| **Exported** | ${new Date().toLocaleString()} |\n`;
    index += `| **Conversations** | ${sorted.length} |\n`;
    index += `| **Artifacts** | ${artifactCount} |\n\n---\n\n`;
    for (let j = 0; j < sorted.length; j++) {
      const e = sorted[j];
      const badge = e.artifactFiles.length > 0 ? ` [${e.artifactFiles.length} artifacts]` : '';
      index += `### ${j + 1}. [${e.name}](./${e.file})${badge}\n`;
      index += `*${new Date(e.created).toLocaleDateString()} — ${formatModelName(e.model)}*\n\n`;
    }
    zip.file('index.md', index);

    // Generate ZIP
    updateProgressText(`Compressing ${sorted.length} conversations...`);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => {
        if (meta.percent) {
          updateProgressText(`Compressing... ${Math.round(meta.percent)}%`);
        }
      }
    );

    // Download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude_export_${getLocalDateTimeString()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
    document.getElementById('progressText').textContent = 'Complete!';
    document.getElementById('progressStats').textContent =
      `${sorted.length} conversations, ${artifactCount} artifacts (${sizeMB} MB)` +
      (failed > 0 ? ` | ${failed} failed` : '');
    document.getElementById('progressBar').style.width = '100%';

    showToast(`Exported ${sorted.length} conversations!`);
    setTimeout(() => modal.classList.remove('show'), 3000);

  } catch (e) {
    document.getElementById('progressText').textContent = `Error: ${e.message}`;
    document.getElementById('progressStats').textContent = `${processed} of ${total} processed before error`;
    setTimeout(() => modal.classList.remove('show'), 5000);
  }
}

function updateProgress(processed, total, artifacts, failed) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  document.getElementById('progressBar').style.width = `${pct}%`;
  document.getElementById('progressText').textContent = `Exporting ${processed} of ${total}...`;
  let stats = `${artifacts} artifacts extracted`;
  if (failed > 0) stats += ` | ${failed} failed`;
  document.getElementById('progressStats').textContent = stats;
}

function updateProgressText(text) {
  document.getElementById('progressText').textContent = text;
}

// --- Export All Grouped by Project ---
// Groups ALL conversations by project, with folder structure:
// {ProjectName}/conversations/, {ProjectName}/artifacts/, Sin_Proyecto/...

async function exportAllGroupedByProject() {
  const total = allConversations.length;
  if (total === 0) return;

  const batchSize = 5;
  const batchDelay = 750;
  const branchOnly = false; // Export all branches for full documentation
  cancelRequested = false;

  // Show progress modal
  const modal = document.getElementById('progressModal');
  modal.querySelector('h3').textContent = 'Exporting Conversations';
  modal.classList.add('show');
  updateProgress(0, total, 0, 0);

  // Group conversations by project
  const groups = {};
  for (const conv of allConversations) {
    const pid = conv.project_uuid || conv.project_id || conv.projectUuid || '__none__';
    if (!groups[pid]) groups[pid] = [];
    groups[pid].push(conv);
  }

  const zip = new JSZip();
  let totalArtifacts = 0;
  let totalConvs = 0;
  let processed = 0;
  let failed = 0;
  const globalIndexEntries = [];

  try {
    for (const [pid, convs] of Object.entries(groups)) {
      const projName = pid === '__none__'
        ? 'Sin_Proyecto'
        : sanitizeFilename(projectsMap[pid] || pid.substring(0, 8));
      const projFolder = zip.folder(projName);
      const convFolder = projFolder.folder('conversations');
      const artFolderRoot = projFolder.folder('artifacts');
      let projArtifactCount = 0;
      const projIndexEntries = [];

      // Process this project's conversations in batches
      for (let i = 0; i < convs.length; i += batchSize) {
        if (cancelRequested) {
          showToast('Export cancelled');
          modal.classList.remove('show');
          return;
        }

        const batchConvs = convs.slice(i, Math.min(i + batchSize, convs.length));
        const batchIds = batchConvs.map((c) => c.uuid);

        let batchResult;
        try {
          batchResult = await sendToClaudeTab('fetchConversationBatch', {
            conversationIds: batchIds,
            orgId,
          });
        } catch (e) {
          failed += batchIds.length;
          processed += batchIds.length;
          updateProgress(processed, total, totalArtifacts, failed);
          continue;
        }

        const fetched = batchResult.conversations || [];
        failed += batchIds.length - fetched.length;

        for (const { convId, data } of fetched) {
          const uuid8 = convId.substring(0, 8);
          const safeName = sanitizeFilename(data.name);
          const folderName = `${safeName}_${uuid8}`;
          const convFilename = `${folderName}.md`;

          const artifacts = extractAllArtifacts(data, branchOnly);
          const artifactFiles = [];

          if (artifacts.size > 0) {
            const convArtFolder = artFolderRoot.folder(folderName);
            for (const [id, art] of artifacts) {
              if (!art.content) continue;
              const artSafeName = sanitizeFilename(art.title || id);
              const ext = art.language ? getFileExtension(art.language) : getExtFromType(art.type);
              const artFilename = `${artSafeName}${ext}`;
              const backlink = `> Source: [${data.name || 'Untitled'}](../../conversations/${convFilename})\n\n---\n\n`;
              convArtFolder.file(artFilename, backlink + art.content);
              artifactFiles.push({ title: art.title || id, filename: artFilename });
              projArtifactCount++;
              totalArtifacts++;
            }
          }

          const md = conversationToMarkdown(data, data, artifactFiles, folderName, branchOnly);
          convFolder.file(convFilename, md);
          totalConvs++;

          projIndexEntries.push({
            name: data.name || 'Untitled',
            file: `conversations/${convFilename}`,
            folder: folderName,
            created: data.created_at,
            updated: data.updated_at,
            model: data.model || 'unknown',
            artifactFiles,
          });
        }

        processed += batchIds.length;
        updateProgress(processed, total, totalArtifacts, failed);

        if (i + batchSize < convs.length) {
          await new Promise((r) => setTimeout(r, batchDelay));
        }
      }

      // Project index
      const sorted = projIndexEntries.sort((a, b) => new Date(b.updated) - new Date(a.updated));
      let projIndex = `# ${projectsMap[pid] || (pid === '__none__' ? 'Sin Proyecto' : pid)}\n\n`;
      projIndex += `| | |\n|---|---|\n`;
      projIndex += `| **Conversations** | ${sorted.length} |\n`;
      projIndex += `| **Artifacts** | ${projArtifactCount} |\n\n---\n\n`;
      for (let j = 0; j < sorted.length; j++) {
        const e = sorted[j];
        const badge = e.artifactFiles.length > 0 ? ` [${e.artifactFiles.length} artifacts]` : '';
        projIndex += `### ${j + 1}. [${e.name}](./${e.file})${badge}\n`;
        projIndex += `*${new Date(e.created).toLocaleDateString()} — ${formatModelName(e.model)}*\n\n`;
        if (e.artifactFiles.length > 0) {
          for (const af of e.artifactFiles) {
            projIndex += `- [${af.title}](./artifacts/${e.folder}/${af.filename})\n`;
          }
          projIndex += `\n`;
        }
      }
      projFolder.file('index.md', projIndex);

      globalIndexEntries.push({
        projectName: projectsMap[pid] || (pid === '__none__' ? 'Sin Proyecto' : pid),
        folderName: projName,
        convCount: sorted.length,
        artifactCount: projArtifactCount,
      });
    }

    // Global index
    let globalIndex = `# Claude Export — All Projects\n\n`;
    globalIndex += `| | |\n|---|---|\n`;
    globalIndex += `| **Exported** | ${new Date().toLocaleString()} |\n`;
    globalIndex += `| **Projects** | ${globalIndexEntries.length} |\n`;
    globalIndex += `| **Conversations** | ${totalConvs} |\n`;
    globalIndex += `| **Artifacts** | ${totalArtifacts} |\n\n---\n\n`;
    globalIndex += `## Projects\n\n`;
    for (const entry of globalIndexEntries) {
      globalIndex += `### [${entry.projectName}](./${entry.folderName}/index.md)\n`;
      globalIndex += `${entry.convCount} conversations, ${entry.artifactCount} artifacts\n\n`;
    }
    zip.file('index.md', globalIndex);

    // Generate ZIP
    updateProgressText(`Compressing ${totalConvs} conversations across ${globalIndexEntries.length} projects...`);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => {
        if (meta.percent) {
          updateProgressText(`Compressing... ${Math.round(meta.percent)}%`);
        }
      }
    );

    // Download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude_export_grouped_${getLocalDateTimeString()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
    document.getElementById('progressText').textContent = 'Complete!';
    document.getElementById('progressStats').textContent =
      `${totalConvs} conversations, ${totalArtifacts} artifacts, ${globalIndexEntries.length} projects (${sizeMB} MB)` +
      (failed > 0 ? ` | ${failed} failed` : '');
    document.getElementById('progressBar').style.width = '100%';

    showToast(`Exported ${totalConvs} conversations across ${globalIndexEntries.length} projects!`);
    setTimeout(() => modal.classList.remove('show'), 3000);

  } catch (e) {
    document.getElementById('progressText').textContent = `Error: ${e.message}`;
    document.getElementById('progressStats').textContent = `${processed} of ${total} processed before error`;
    setTimeout(() => modal.classList.remove('show'), 5000);
  }
}
