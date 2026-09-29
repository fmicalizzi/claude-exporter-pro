// ============================================================================
// Claude Exporter Pro — Shared Utilities
// ============================================================================

// --- Sanitization ---

function sanitizeFilename(name) {
  if (!name) return 'untitled';
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 80) || 'untitled';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- File Extension Mapping (50+ languages) ---

const LANGUAGE_TO_EXT = {
  javascript: '.js', typescript: '.ts', python: '.py', java: '.java',
  c: '.c', cpp: '.cpp', 'c++': '.cpp', ruby: '.rb', php: '.php',
  swift: '.swift', go: '.go', rust: '.rs', tsx: '.tsx', jsx: '.jsx',
  shell: '.sh', bash: '.sh', sql: '.sql', kotlin: '.kt', scala: '.scala',
  r: '.r', matlab: '.m', json: '.json', xml: '.xml', yaml: '.yaml',
  yml: '.yml', markdown: '.md', md: '.md', text: '.txt', txt: '.txt',
  html: '.html', css: '.css', scss: '.scss', sass: '.sass', less: '.less',
  stylus: '.styl', svg: '.svg', csv: '.csv', toml: '.toml', ini: '.ini',
  perl: '.pl', lua: '.lua', dart: '.dart', elixir: '.ex', erlang: '.erl',
  haskell: '.hs', clojure: '.clj', fsharp: '.fs', 'f#': '.fs',
  csharp: '.cs', 'c#': '.cs', 'objective-c': '.m', ocaml: '.ml',
  scheme: '.scm', lisp: '.lisp', fortran: '.f90', assembly: '.asm',
  asm: '.asm', dockerfile: '.dockerfile', makefile: '.mk',
  gradle: '.gradle', groovy: '.groovy', latex: '.tex', tex: '.tex',
  bibtex: '.bib', bib: '.bib', mermaid: '.mmd',
};

function getFileExtension(language) {
  if (!language) return '.txt';
  return LANGUAGE_TO_EXT[language.toLowerCase()] || '.txt';
}

// Get extension from artifact type string (v2 compat)
function getExtFromType(typeStr) {
  const t = (typeStr || '').toLowerCase();
  if (t.includes('markdown') || t === 'md') return '.md';
  if (t.includes('html')) return '.html';
  if (t.includes('react')) return '.jsx';
  if (t.includes('mermaid')) return '.mmd';
  if (t.includes('svg')) return '.svg';
  if (t.includes('csv')) return '.csv';
  if (t.includes('json')) return '.json';
  if (t.includes('python') || t === 'py') return '.py';
  if (t.includes('javascript') || t === 'js') return '.js';
  if (t.includes('typescript') || t === 'ts') return '.ts';
  if (t.includes('css')) return '.css';
  if (t.includes('code') && t.includes('/')) {
    // Handle application/vnd.ant.code with language attribute
    return '.txt';
  }
  return getFileExtension(t) || '.md';
}

const PROGRAMMING_LANGUAGES = new Set([
  'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'c++', 'ruby',
  'php', 'swift', 'go', 'rust', 'jsx', 'tsx', 'shell', 'bash', 'sql',
  'kotlin', 'scala', 'r', 'perl', 'lua', 'dart', 'elixir', 'erlang',
  'haskell', 'clojure', 'fsharp', 'f#', 'c#', 'csharp', 'objective-c',
  'ocaml', 'scheme', 'lisp', 'fortran', 'assembly', 'asm', 'groovy',
  'html', 'css', 'scss', 'sass', 'less', 'stylus',
]);

function isProgrammingLanguage(language) {
  return PROGRAMMING_LANGUAGES.has((language || '').toLowerCase());
}

// --- Model Inference ---

const DEFAULT_MODEL_TIMELINE = [
  { date: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229' },
  { date: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620' },
  { date: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022' },
  { date: new Date('2025-02-24'), model: 'claude-3-7-sonnet-20250219' },
  { date: new Date('2025-05-22'), model: 'claude-sonnet-4-20250514' },
  { date: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929' },
  { date: new Date('2026-02-17'), model: 'claude-sonnet-4-6' },
];

function inferModel(conversation) {
  if (conversation.model) return conversation.model;
  const d = new Date(conversation.created_at);
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (d >= DEFAULT_MODEL_TIMELINE[i].date) return DEFAULT_MODEL_TIMELINE[i].model;
  }
  return DEFAULT_MODEL_TIMELINE[0].model;
}

function formatModelName(model) {
  if (!model || !model.startsWith('claude-')) return model || 'Unknown';
  // New format: claude-{type}-{major}[-{minor}][-{date}]
  const newMatch = model.match(/^claude-(sonnet|opus|haiku)-(\d+)(?:-(\d+))?(?:-\d{8})?$/i);
  if (newMatch) {
    const [, type, major, minor] = newMatch;
    const name = type.charAt(0).toUpperCase() + type.slice(1);
    return `Claude ${name} ${minor ? major + '.' + minor : major}`;
  }
  // Old format: claude-{major}[-{minor}]-{type}-{date}
  const oldMatch = model.match(/^claude-(\d+)(?:-(\d+))?-(sonnet|opus|haiku)-\d{8}$/i);
  if (oldMatch) {
    const [, major, minor, type] = oldMatch;
    const name = type.charAt(0).toUpperCase() + type.slice(1);
    return `Claude ${name} ${minor ? major + '.' + minor : major}`;
  }
  return model;
}

// --- Branch Resolution ---

function getCurrentBranch(data) {
  if (!data.chat_messages || !data.current_leaf_message_uuid) return [];
  const messageMap = new Map();
  data.chat_messages.forEach((msg) => messageMap.set(msg.uuid, msg));
  const branch = [];
  let currentUuid = data.current_leaf_message_uuid;
  while (currentUuid && messageMap.has(currentUuid)) {
    const message = messageMap.get(currentUuid);
    branch.unshift(message);
    currentUuid = message.parent_message_uuid;
    if (!messageMap.has(currentUuid)) break;
  }
  return branch;
}

function getMessages(data, branchOnly) {
  if (branchOnly) return getCurrentBranch(data);
  return data.chat_messages || [];
}

// ============================================================================
// Artifact Extraction — 6 Methods
// ============================================================================

// Extract artifacts from a single message (methods 4, 5, 6)
function extractArtifactsFromMessage(message) {
  const artifacts = [];
  if (message.content && Array.isArray(message.content)) {
    for (const content of message.content) {
      // Method 4: display_content.code_block
      if (content.type === 'tool_use' && content.display_content) {
        const dc = content.display_content;
        if (dc.type === 'code_block' && dc.code) {
          const language = dc.language || 'txt';
          const filename = dc.filename || 'artifact';
          const title = filename.split('/').pop().replace(/\.[^.]+$/, '');
          artifacts.push({
            title: title || 'Untitled',
            language: language,
            type: isProgrammingLanguage(language) ? 'code' : 'document',
            content: dc.code.trim(),
          });
        }
        // Method 5: display_content.json_block
        else if (dc.type === 'json_block' && dc.json_block) {
          try {
            const parsed = JSON.parse(dc.json_block);
            if (parsed.filename) {
              const language = parsed.language || 'txt';
              const title = parsed.filename.split('/').pop().replace(/\.[^.]+$/, '');
              artifacts.push({
                title: title || 'Untitled',
                language: language,
                type: isProgrammingLanguage(language) ? 'code' : 'document',
                content: (parsed.code || '').trim(),
              });
            }
          } catch (e) {
            // JSON parse failed, skip
          }
        }
      }
      // Method 6: <antArtifact> tags in text
      if (content.text) {
        artifacts.push(...extractArtifactsFromText(content.text));
      }
    }
  }
  // Fallback: message.text directly (older format)
  if (message.text) {
    artifacts.push(...extractArtifactsFromText(message.text));
  }
  return artifacts;
}

// Method 6: Extract artifacts from text using <antArtifact> regex
function extractArtifactsFromText(text) {
  const regex = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g;
  const artifacts = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const fullTag = match[0];
    const content = match[1];
    const titleMatch = fullTag.match(/title="([^"]*)"/);
    const typeMatch = fullTag.match(/type="([^"]*)"/);
    const languageMatch = fullTag.match(/language="([^"]*)"/);
    const identifierMatch = fullTag.match(/identifier="([^"]*)"/);

    let artifactType = 'text';
    let language = 'txt';

    if (typeMatch) {
      const t = typeMatch[1];
      if (t === 'text/html') { language = 'html'; artifactType = 'code'; }
      else if (t === 'text/markdown') { language = 'markdown'; artifactType = 'document'; }
      else if (t === 'application/vnd.ant.code') { language = languageMatch ? languageMatch[1] : 'txt'; artifactType = 'code'; }
      else if (t === 'text/css') { language = 'css'; artifactType = 'code'; }
      else if (t === 'application/vnd.ant.mermaid') { language = 'mermaid'; artifactType = 'document'; }
      else if (t === 'application/vnd.ant.react') { language = 'jsx'; artifactType = 'code'; }
      else if (t === 'image/svg+xml') { language = 'svg'; artifactType = 'code'; }
    } else if (languageMatch) {
      language = languageMatch[1];
      artifactType = 'code';
    }

    artifacts.push({
      title: titleMatch ? titleMatch[1] : 'Untitled',
      language: language,
      type: artifactType,
      identifier: identifierMatch ? identifierMatch[1] : null,
      content: content.trim(),
    });
  }
  return artifacts;
}

// Remove <antArtifact> tags from text (to avoid duplication)
function cleanAntArtifactTags(text) {
  return text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
}

// Extract all artifacts from a conversation using all 6 methods
// Returns a Map of id -> { title, content, type, language }
function extractAllArtifacts(convData, branchOnly) {
  const artifacts = new Map();
  if (!convData?.chat_messages) return artifacts;

  const messages = getMessages(convData, branchOnly);

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type !== 'tool_use' || !block.input) continue;
      const input = block.input;
      const tool = block.name || '';

      // Method 1: "artifacts" tool (personal accounts)
      if (tool === 'artifacts') {
        const id = input.id || input.identifier || 'unknown';
        if (input.command === 'create' || input.command === 'new') {
          artifacts.set(id, {
            title: input.title || id,
            content: input.content || input.new_str || '',
            type: input.type || input.language || 'md',
            language: input.language || null,
          });
        } else if (input.command === 'update' || input.command === 'rewrite') {
          const existing = artifacts.get(id);
          if (existing) {
            if (input.new_str && input.old_str) {
              existing.content = existing.content.replace(input.old_str, input.new_str);
            } else if (input.content || input.new_str) {
              existing.content = input.content || input.new_str;
            }
            if (input.title) existing.title = input.title;
          } else {
            artifacts.set(id, {
              title: input.title || id,
              content: input.content || input.new_str || '',
              type: input.type || input.language || 'md',
              language: input.language || null,
            });
          }
        }
      }

      // Method 2: "create_file" tool (Team/Enterprise)
      if (tool === 'create_file' && input.file_text && input.path) {
        const filename = input.path.split('/').pop();
        const ext = filename.split('.').pop() || 'txt';
        artifacts.set(input.path, {
          title: filename,
          content: input.file_text,
          type: ext,
          language: ext,
        });
      }

      // Method 3: "str_replace" tool (edits in Team/Enterprise)
      if (tool === 'str_replace' && input.path) {
        const existing = artifacts.get(input.path);
        if (existing && input.old_str && input.new_str) {
          existing.content = existing.content.replace(input.old_str, input.new_str);
        }
      }

      // Methods 4 & 5: display_content (code_block / json_block)
      if (block.display_content) {
        const dc = block.display_content;
        if (dc.type === 'code_block' && dc.code) {
          const filename = dc.filename || 'artifact';
          const language = dc.language || 'txt';
          const key = `dc_${filename}_${artifacts.size}`;
          artifacts.set(key, {
            title: filename.split('/').pop().replace(/\.[^.]+$/, '') || 'Untitled',
            content: dc.code.trim(),
            type: isProgrammingLanguage(language) ? 'code' : 'document',
            language: language,
          });
        } else if (dc.type === 'json_block' && dc.json_block) {
          try {
            const parsed = JSON.parse(dc.json_block);
            if (parsed.filename) {
              const language = parsed.language || 'txt';
              const key = `jb_${parsed.filename}_${artifacts.size}`;
              artifacts.set(key, {
                title: parsed.filename.split('/').pop().replace(/\.[^.]+$/, '') || 'Untitled',
                content: (parsed.code || '').trim(),
                type: isProgrammingLanguage(language) ? 'code' : 'document',
                language: language,
              });
            }
          } catch (e) { /* skip */ }
        }
      }
    }

    // Method 6: <antArtifact> tags in text blocks
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.text) {
          const tagArtifacts = extractArtifactsFromText(block.text);
          for (const art of tagArtifacts) {
            const key = `ant_${art.identifier || art.title}_${artifacts.size}`;
            artifacts.set(key, {
              title: art.title,
              content: art.content,
              type: art.language,
              language: art.language,
            });
          }
        }
      }
    }
  }
  return artifacts;
}

// ============================================================================
// Markdown Conversion
// ============================================================================

function conversationToMarkdown(metadata, data, artifactFiles, convFolder, branchOnly) {
  if (!data?.chat_messages) {
    return `# ${metadata.name || 'Untitled'}\n\n*Failed to load*\n`;
  }

  let md = `# ${data.name || metadata.name || 'Untitled'}\n\n`;

  // Artifact links at top (bidirectional)
  if (artifactFiles && artifactFiles.length > 0) {
    md += `## Artifacts (${artifactFiles.length})\n\n`;
    for (const af of artifactFiles) {
      md += `- [${af.title}](../artifacts/${convFolder}/${af.filename})\n`;
    }
    md += `\n---\n\n`;
  }

  if (data.summary) md += `**Summary:** ${data.summary}\n\n`;
  md += `*Created: ${new Date(data.created_at || metadata.created_at).toLocaleString()}*\n`;
  md += `*Updated: ${new Date(data.updated_at || metadata.updated_at).toLocaleString()}*\n`;
  const model = metadata.model || data.model;
  if (model) md += `*Model: ${formatModelName(model)}*\n`;
  md += `\n---\n\n`;

  const messages = getMessages(data, branchOnly);

  for (const msg of messages) {
    const sender = msg.sender === 'human' ? '## User' : '## Claude';
    md += `${sender}\n\n`;

    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'thinking' && block.thinking) {
          md += `**Thinking:**\n\`\`\`\`\n${block.thinking}\n\`\`\`\`\n\n`;
        } else if (block.type === 'text' && block.text) {
          // Clean antArtifact tags from text
          const cleaned = cleanAntArtifactTags(block.text);
          if (cleaned) md += `${cleaned}\n\n`;
        } else if (block.type === 'tool_use' && block.input) {
          if (block.name === 'artifacts') {
            const inp = block.input;
            md += `**[Artifact: ${inp.command} "${inp.title || inp.id || ''}"]**\n\n`;
          } else if (block.name === 'create_file' && block.input.path) {
            md += `**[File created: ${block.input.path.split('/').pop()}]**\n\n`;
          } else if (block.name === 'str_replace' && block.input.path) {
            md += `**[File edited: ${block.input.path.split('/').pop()}]**\n\n`;
          } else if (block.display_content) {
            const dc = block.display_content;
            if (dc.type === 'code_block') {
              md += `**[Artifact: ${dc.filename || 'code'}]**\n\n`;
            } else if (dc.type === 'json_block') {
              try {
                const p = JSON.parse(dc.json_block);
                if (p.filename) md += `**[Artifact: ${p.filename}]**\n\n`;
              } catch (e) { /* skip */ }
            }
          } else {
            md += `**Tool Use (${block.name}):**\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n\n`;
          }
        } else if (block.type === 'tool_result' && block.content) {
          md += `**Tool Result:**\n\`\`\`\n`;
          if (Array.isArray(block.content)) {
            block.content.forEach((item) => {
              if (item.type === 'text') md += item.text;
            });
          } else {
            md += JSON.stringify(block.content, null, 2);
          }
          md += `\n\`\`\`\n\n`;
        }
      }
    }

    // Attachments
    if (msg.attachments?.length > 0) {
      md += `### Attachments\n`;
      for (const att of msg.attachments) {
        md += `- **${att.file_name || 'Attachment'}** (${att.file_type || 'file'})\n`;
        if (att.extracted_content) {
          const content = att.extracted_content.length < 2000
            ? att.extracted_content
            : att.extracted_content.substring(0, 1000) + '...';
          md += `  \`\`\`\n${content}\n  \`\`\`\n`;
        }
      }
      md += `\n`;
    }

    md += `*${new Date(msg.created_at).toLocaleString()}*\n\n---\n\n`;
  }

  return md;
}

// Plain text conversion
function conversationToText(data, branchOnly) {
  let text = `${data.name || 'Untitled Conversation'}\n`;
  text += `Created: ${new Date(data.created_at).toLocaleString()}\n`;
  text += `Updated: ${new Date(data.updated_at).toLocaleString()}\n`;
  text += `Model: ${formatModelName(data.model)}\n\n---\n\n`;

  const messages = getMessages(data, branchOnly);
  for (const msg of messages) {
    const label = msg.sender === 'human' ? 'User' : 'Claude';
    let msgText = '';
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          msgText += cleanAntArtifactTags(block.text) + ' ';
        }
      }
    } else if (msg.text) {
      msgText = cleanAntArtifactTags(msg.text);
    }
    text += `${label}: ${msgText.trim()}\n\n`;
  }
  return text.trim();
}

// --- Download helper ---

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Date/time helpers ---

function getLocalDateTimeString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
