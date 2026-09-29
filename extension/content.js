// Prevent double-injection
if (window.claudeExporterProLoaded) {
  console.log('Claude Exporter Pro: content script already loaded, skipping');
} else {
  window.claudeExporterProLoaded = true;

  // ============================================================================
  // Auto-detect Organization ID
  // ============================================================================

  function getOrgIdFromCookie() {
    const match = document.cookie
      .split('; ')
      .find((c) => c.startsWith('lastActiveOrg='));
    return match ? match.split('=')[1] : null;
  }

  // ============================================================================
  // API Layer
  // ============================================================================

  const RETRY_COUNT = 3;

  async function apiFetch(url) {
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
      try {
        const res = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (res.status === 429) {
          const wait = Math.min(1000 * Math.pow(2, attempt), 15000);
          console.log(`Rate limited, waiting ${wait}ms...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        if (attempt === RETRY_COUNT) {
          console.error('API fetch failed:', url, e);
          return null;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    return null;
  }

  async function fetchConversation(orgId, conversationId) {
    return await apiFetch(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`
    );
  }

  async function fetchAllConversations(orgId) {
    return await apiFetch(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations`
    );
  }

  async function fetchProjectConversations(orgId, projectId) {
    const data = await apiFetch(
      `https://claude.ai/api/organizations/${orgId}/projects/${projectId}/conversations_v2?limit=1000&offset=0`
    );
    if (!data) return null;
    return data.data || data;
  }

  async function fetchProjects(orgId) {
    return await apiFetch(
      `https://claude.ai/api/organizations/${orgId}/projects`
    );
  }

  // ============================================================================
  // Standalone artifacts ("Artefactos" / code frames)
  // ============================================================================

  // The /api/frame/* endpoints reject requests that lack these headers (404).
  // The session id can be any value; it is not validated against a real session.
  const FRAME_SESSION_ID =
    (self.crypto && self.crypto.randomUUID && self.crypto.randomUUID()) ||
    `ce_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const FRAME_HEADERS = {
    Accept: 'application/json',
    'x-frame-surface': 'standalone',
    'x-frame-platform': 'web',
    'x-frame-cp': 'go',
    'x-frame-session-id': FRAME_SESSION_ID,
  };

  async function apiFetchFrame(url) {
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
      try {
        const res = await fetch(url, {
          credentials: 'include',
          headers: FRAME_HEADERS,
        });
        if (res.status === 429) {
          const wait = Math.min(1000 * Math.pow(2, attempt), 15000);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        if (attempt === RETRY_COUNT) {
          console.error('Frame API fetch failed:', url, e);
          return null;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    return null;
  }

  // List all standalone artifacts (owned + shared), deduped by slug.
  async function fetchFrames(orgId) {
    const base = `https://claude.ai/api/frame/frames?thumb=1&limit=500&org=${orgId}`;
    const [mine, shared] = await Promise.all([
      apiFetchFrame(base),
      apiFetchFrame(`${base}&rel=shared`),
    ]);
    const bySlug = new Map();
    for (const resp of [mine, shared]) {
      const frames = (resp && resp.frames) || [];
      for (const f of frames) {
        if (f && f.slug && !bySlug.has(f.slug)) bySlug.set(f.slug, f);
      }
    }
    return [...bySlug.values()];
  }

  // Per-artifact metadata + a fresh assetToken needed to load the frame.
  async function fetchFrameMeta(orgId, slug) {
    return await apiFetchFrame(
      `https://claude.ai/api/frame/${slug}?org=${orgId}&via=user_open&bk=initial`
    );
  }

  // The frame host serves content only when embedded from an allowed ancestor
  // (frame-ancestors CSP = claude.ai + Anthropic origins). So we mount the
  // hidden iframe HERE, inside the claude.ai tab, and let frame_reader.js
  // (injected into the frame) post the HTML back to this top window.
  const FRAME_RENDER_TIMEOUT = 15000;

  function renderAndReadFrame(host, mount) {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText =
        'position:fixed;left:-99999px;top:0;width:1024px;height:768px;border:0;opacity:0;pointer-events:none;';
      let done = false;
      const finish = (html, method) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        try { iframe.remove(); } catch (e) {}
        resolve({ html, method });
      };
      const onMsg = (ev) => {
        if (!ev.data || !ev.data.__claudeExporterFrame) return;
        let h = '';
        try { h = new URL(ev.data.url).host; } catch (e) {}
        if (h !== host) return;
        finish(ev.data.html, ev.data.method);
      };
      window.addEventListener('message', onMsg);
      iframe.addEventListener('error', () => finish(null, 'iframe-error'));
      const timer = setTimeout(() => finish(null, 'timeout'), FRAME_RENDER_TIMEOUT);
      iframe.src = mount;
      document.documentElement.appendChild(iframe);
    });
  }

  // Fetch metadata + the served HTML for one standalone artifact.
  async function fetchFrameContent(orgId, slug) {
    const meta = await fetchFrameMeta(orgId, slug);
    if (!meta || !meta.live || !meta.assetToken) {
      return { success: false, error: 'Failed to fetch frame metadata' };
    }
    const host = `${slug}.frame.claudeusercontent.com`;
    const mount = `https://${host}/_f/${meta.live}/?__frame_t=${encodeURIComponent(meta.assetToken)}`;
    const { html, method } = await renderAndReadFrame(host, mount);
    return {
      success: !!html,
      error: html ? undefined : `Could not read frame (${method})`,
      html: html || null,
      method,
      meta: {
        slug,
        title: meta.title || slug,
        favicon: meta.favicon || '',
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        author: meta.author || null,
        source_surface: meta.source_surface || 'code',
      },
    };
  }

  // ============================================================================
  // Export Logic
  // ============================================================================

  async function exportSingleConversation(request) {
    const orgId = request.orgId || getOrgIdFromCookie();
    if (!orgId) return { success: false, error: 'Could not detect Organization ID. Make sure you are logged into Claude.ai.' };

    const data = await fetchConversation(orgId, request.conversationId);
    if (!data || !data.chat_messages) {
      return { success: false, error: 'Failed to fetch conversation data.' };
    }

    // Infer model
    data.model = inferModel(data);

    const branchOnly = request.branchOnly !== false; // default true for single
    const format = request.format || 'markdown';
    const includeArtifacts = request.extractArtifacts || false;

    if (includeArtifacts) {
      const artifacts = extractAllArtifacts(data, branchOnly);
      const zip = new JSZip();
      const safeName = sanitizeFilename(data.name || request.conversationId);

      // Add conversation file
      const md = conversationToMarkdown(
        data, data, [], safeName, branchOnly
      );
      if (format === 'markdown') {
        zip.file(`${safeName}.md`, md);
      } else if (format === 'text') {
        zip.file(`${safeName}.txt`, conversationToText(data, branchOnly));
      } else {
        zip.file(`${safeName}.json`, JSON.stringify(data, null, 2));
      }

      // Add artifacts
      if (artifacts.size > 0) {
        const artFolder = zip.folder('artifacts');
        for (const [id, art] of artifacts) {
          if (!art.content) continue;
          const artName = sanitizeFilename(art.title || id);
          const ext = art.language ? getFileExtension(art.language) : getExtFromType(art.type);
          const filename = `${artName}${ext}`;
          const backlink = `> Source: [${data.name || 'Conversation'}](../${safeName}.md)\n\n---\n\n`;
          artFolder.file(filename, backlink + art.content);
        }
      }

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      downloadBlob(blob, `${safeName}.zip`);
    } else {
      // Simple export without artifact extraction
      let content, filename, type;
      if (format === 'markdown') {
        content = conversationToMarkdown(data, data, [], '', branchOnly);
        filename = `${sanitizeFilename(data.name || request.conversationId)}.md`;
        type = 'text/markdown';
      } else if (format === 'text') {
        content = conversationToText(data, branchOnly);
        filename = `${sanitizeFilename(data.name || request.conversationId)}.txt`;
        type = 'text/plain';
      } else {
        content = JSON.stringify(data, null, 2);
        filename = `${sanitizeFilename(data.name || request.conversationId)}.json`;
        type = 'application/json';
      }
      downloadFile(content, filename, type);
    }

    return { success: true };
  }

  async function exportProject(request) {
    const orgId = request.orgId || getOrgIdFromCookie();
    if (!orgId) return { success: false, error: 'Could not detect Organization ID.' };

    const projectId = request.projectId;
    if (!projectId) return { success: false, error: 'No project ID provided.' };

    const convList = await fetchProjectConversations(orgId, projectId);
    if (!convList || convList.length === 0) {
      return { success: false, error: 'No conversations found in this project.' };
    }

    const projectName = request.projectName || 'project';
    const branchOnly = request.branchOnly === true; // default false for bulk
    const batchSize = 5;
    const batchDelay = 750;

    const zip = new JSZip();
    const convFolder = zip.folder('conversations');
    const artFolder = zip.folder('artifacts');
    let artifactCount = 0;
    const indexEntries = [];

    for (let i = 0; i < convList.length; i += batchSize) {
      const batch = convList.slice(i, Math.min(i + batchSize, convList.length));

      const results = await Promise.allSettled(
        batch.map(async (conv) => {
          const data = await fetchConversation(orgId, conv.uuid);
          if (!data) return { conv, data: null };
          data.model = inferModel(data);
          return { conv, data, artifacts: extractAllArtifacts(data, branchOnly) };
        })
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { conv, data, artifacts } = result.value;
        if (!data) continue;

        const uuid8 = (conv.uuid || '').substring(0, 8);
        const safeName = sanitizeFilename(conv.name);
        const folderName = `${safeName}_${uuid8}`;
        const convFilename = `${folderName}.md`;

        // Build artifact files
        const artifactFiles = [];
        if (artifacts && artifacts.size > 0) {
          const convArtFolder = artFolder.folder(folderName);
          for (const [id, art] of artifacts) {
            if (!art.content) continue;
            const artSafeName = sanitizeFilename(art.title || id);
            const ext = art.language ? getFileExtension(art.language) : getExtFromType(art.type);
            const artFilename = `${artSafeName}${ext}`;
            const backlink = `> Source: [${conv.name || 'Untitled'}](../../conversations/${convFilename})\n\n---\n\n`;
            convArtFolder.file(artFilename, backlink + art.content);
            artifactFiles.push({ title: art.title || id, filename: artFilename });
            artifactCount++;
          }
        }

        // Write conversation markdown
        const md = conversationToMarkdown(conv, data, artifactFiles, folderName, branchOnly);
        convFolder.file(convFilename, md);

        indexEntries.push({
          name: conv.name || 'Untitled',
          file: `conversations/${convFilename}`,
          folder: folderName,
          created: conv.created_at,
          updated: conv.updated_at,
          model: conv.model || data.model || 'unknown',
          artifactFiles: artifactFiles,
        });
      }

      // Report progress
      if (request._progressCallback) {
        request._progressCallback(Math.min(i + batchSize, convList.length), convList.length);
      }

      if (i + batchSize < convList.length) {
        await new Promise((r) => setTimeout(r, batchDelay));
      }
    }

    // Generate index
    const sorted = indexEntries.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    let index = `# ${projectName} — Export\n\n`;
    index += `| | |\n|---|---|\n`;
    index += `| **Project** | ${projectName} |\n`;
    index += `| **Exported** | ${new Date().toLocaleString()} |\n`;
    index += `| **Conversations** | ${sorted.length} |\n`;
    index += `| **Artifacts** | ${artifactCount} |\n\n---\n\n`;
    index += `## Conversations\n\n`;

    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const badge = e.artifactFiles.length > 0 ? ` [${e.artifactFiles.length} artifacts]` : '';
      index += `### ${i + 1}. [${e.name}](./${e.file})${badge}\n`;
      index += `*${new Date(e.created).toLocaleDateString()} — ${formatModelName(e.model)}*\n\n`;
      if (e.artifactFiles.length > 0) {
        for (const af of e.artifactFiles) {
          index += `- [${af.title}](./artifacts/${e.folder}/${af.filename})\n`;
        }
        index += `\n`;
      }
    }
    zip.file('index.md', index);

    // Generate ZIP
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const zipFilename = `${sanitizeFilename(projectName)}_${projectId.substring(0, 8)}_export.zip`;
    downloadBlob(blob, zipFilename);

    return {
      success: true,
      count: sorted.length,
      artifacts: artifactCount,
    };
  }

  async function exportAllGrouped(request) {
    const orgId = request.orgId || getOrgIdFromCookie();
    if (!orgId) return { success: false, error: 'Could not detect Organization ID.' };

    // Fetch all conversations and projects
    const [allConvs, projects] = await Promise.all([
      fetchAllConversations(orgId),
      fetchProjects(orgId),
    ]);

    if (!allConvs || allConvs.length === 0) {
      return { success: false, error: 'No conversations found.' };
    }

    // Build project name map
    const projectMap = {};
    if (projects) {
      for (const p of projects) {
        const pid = p.uuid || p.id;
        projectMap[pid] = p.name || p.title || 'Untitled Project';
      }
    }

    // Group conversations by project
    const groups = {};
    for (const conv of allConvs) {
      const pid = conv.project_uuid || conv.project_id || conv.projectUuid || '__none__';
      if (!groups[pid]) groups[pid] = [];
      groups[pid].push(conv);
    }

    const branchOnly = request.branchOnly === true;
    const batchSize = 5;
    const batchDelay = 750;
    const zip = new JSZip();
    let totalArtifacts = 0;
    let totalConvs = 0;
    const globalIndexEntries = [];

    const totalToProcess = allConvs.length;
    let processed = 0;

    for (const [pid, convs] of Object.entries(groups)) {
      const projName = pid === '__none__' ? 'Sin_Proyecto' : sanitizeFilename(projectMap[pid] || pid.substring(0, 8));
      const projFolder = zip.folder(projName);
      const convFolder = projFolder.folder('conversations');
      const artFolder = projFolder.folder('artifacts');
      let projArtifactCount = 0;
      const projIndexEntries = [];

      for (let i = 0; i < convs.length; i += batchSize) {
        const batch = convs.slice(i, Math.min(i + batchSize, convs.length));

        const results = await Promise.allSettled(
          batch.map(async (conv) => {
            const data = await fetchConversation(orgId, conv.uuid);
            if (!data) return { conv, data: null };
            data.model = inferModel(data);
            return { conv, data, artifacts: extractAllArtifacts(data, branchOnly) };
          })
        );

        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const { conv, data, artifacts } = result.value;
          if (!data) continue;

          const uuid8 = (conv.uuid || '').substring(0, 8);
          const safeName = sanitizeFilename(conv.name);
          const folderName = `${safeName}_${uuid8}`;
          const convFilename = `${folderName}.md`;

          const artifactFiles = [];
          if (artifacts && artifacts.size > 0) {
            const convArtFolder = artFolder.folder(folderName);
            for (const [id, art] of artifacts) {
              if (!art.content) continue;
              const artSafeName = sanitizeFilename(art.title || id);
              const ext = art.language ? getFileExtension(art.language) : getExtFromType(art.type);
              const artFilename = `${artSafeName}${ext}`;
              const backlink = `> Source: [${conv.name || 'Untitled'}](../../conversations/${convFilename})\n\n---\n\n`;
              convArtFolder.file(artFilename, backlink + art.content);
              artifactFiles.push({ title: art.title || id, filename: artFilename });
              projArtifactCount++;
              totalArtifacts++;
            }
          }

          const md = conversationToMarkdown(conv, data, artifactFiles, folderName, branchOnly);
          convFolder.file(convFilename, md);
          totalConvs++;

          projIndexEntries.push({
            name: conv.name || 'Untitled',
            file: `conversations/${convFilename}`,
            folder: folderName,
            created: conv.created_at,
            updated: conv.updated_at,
            model: conv.model || data.model || 'unknown',
            artifactFiles: artifactFiles,
          });
        }

        processed += batch.length;
        if (request._progressCallback) {
          request._progressCallback(processed, totalToProcess);
        }

        if (i + batchSize < convs.length) {
          await new Promise((r) => setTimeout(r, batchDelay));
        }
      }

      // Project index
      const sorted = projIndexEntries.sort((a, b) => new Date(b.updated) - new Date(a.updated));
      let projIndex = `# ${projectMap[pid] || 'Sin Proyecto'}\n\n`;
      projIndex += `| | |\n|---|---|\n`;
      projIndex += `| **Conversations** | ${sorted.length} |\n`;
      projIndex += `| **Artifacts** | ${projArtifactCount} |\n\n---\n\n`;

      for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i];
        const badge = e.artifactFiles.length > 0 ? ` [${e.artifactFiles.length} artifacts]` : '';
        projIndex += `### ${i + 1}. [${e.name}](./${e.file})${badge}\n`;
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
        projectName: projectMap[pid] || (pid === '__none__' ? 'Sin Proyecto' : pid),
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

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const zipFilename = `claude_export_${getLocalDateTimeString()}.zip`;
    downloadBlob(blob, zipFilename);

    return {
      success: true,
      count: totalConvs,
      artifacts: totalArtifacts,
      projects: globalIndexEntries.length,
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ============================================================================
  // Message Handler
  // ============================================================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handler = async () => {
      try {
        switch (request.action) {
          case 'getOrgId': {
            const orgId = getOrgIdFromCookie();
            return { success: !!orgId, orgId };
          }

          case 'getPageInfo': {
            const orgId = getOrgIdFromCookie();
            const convMatch = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
            const projMatch = window.location.pathname.match(/\/project\/([a-f0-9-]+)/);
            return {
              success: true,
              orgId,
              conversationId: convMatch ? convMatch[1] : null,
              projectId: projMatch ? projMatch[1] : null,
              url: window.location.href,
            };
          }

          case 'loadConversations': {
            const orgId = request.orgId || getOrgIdFromCookie();
            if (!orgId) return { success: false, error: 'No org ID' };
            const conversations = await fetchAllConversations(orgId);
            return { success: true, conversations: conversations || [] };
          }

          case 'loadProjects': {
            const orgId = request.orgId || getOrgIdFromCookie();
            if (!orgId) return { success: false, error: 'No org ID' };
            const projects = await fetchProjects(orgId);
            return { success: true, projects: projects || [] };
          }

          case 'loadProjectConversations': {
            const orgId = request.orgId || getOrgIdFromCookie();
            if (!orgId) return { success: false, error: 'No org ID' };
            const convs = await fetchProjectConversations(orgId, request.projectId);
            return { success: true, conversations: convs || [] };
          }

          case 'loadFrames': {
            const orgId = request.orgId || getOrgIdFromCookie();
            if (!orgId) return { success: false, error: 'No org ID' };
            const frames = await fetchFrames(orgId);
            return { success: true, frames };
          }

          case 'fetchFrameContent': {
            const orgId = request.orgId || getOrgIdFromCookie();
            if (!orgId) return { success: false, error: 'No org ID' };
            if (!request.slug) return { success: false, error: 'No slug' };
            return await fetchFrameContent(orgId, request.slug);
          }

          case 'exportConversation': {
            return await exportSingleConversation(request);
          }

          case 'exportProject': {
            return await exportProject(request);
          }

          case 'exportAllGrouped': {
            return await exportAllGrouped(request);
          }

          case 'fetchConversationBatch': {
            // Fetch a batch of conversations (data only, no ZIP)
            // browse.js orchestrates the export and builds the ZIP locally
            const orgId = request.orgId || getOrgIdFromCookie();
            if (!orgId) return { success: false, error: 'No org ID' };

            const ids = request.conversationIds || [];
            if (ids.length === 0) return { success: false, error: 'No conversation IDs' };

            const results = await Promise.allSettled(
              ids.map(async (convId) => {
                const data = await fetchConversation(orgId, convId);
                if (!data) return { convId, data: null };
                data.model = inferModel(data);
                return { convId, data };
              })
            );

            const conversations = [];
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value.data) {
                conversations.push(result.value);
              }
            }

            return { success: true, conversations };
          }

          default:
            return { success: false, error: `Unknown action: ${request.action}` };
        }
      } catch (error) {
        console.error('Claude Exporter Pro error:', error);
        return { success: false, error: error.message };
      }
    };

    handler().then(sendResponse);
    return true; // Keep message channel open for async
  });

  console.log('Claude Exporter Pro: content script loaded');
}
