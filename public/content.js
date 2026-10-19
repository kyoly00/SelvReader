const ROOT_ID = 'selvreader-selection-root';
const SETTINGS_KEY = 'selvreader-settings';
let selectedText = '';
let selectedRange = null;
let activeCitationMap = null;
let activeCitationByUrl = null;
let webToolsEnabled = false;

initializeFeatureState();

function initializeFeatureState() {
  const storage = globalThis.chrome?.storage;
  if (!storage?.local) return;
  storage.local.get(SETTINGS_KEY, (stored) => {
    if (chrome.runtime.lastError) return;
    setWebToolsEnabled(stored?.[SETTINGS_KEY]?.enabled !== false);
  });
  storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    setWebToolsEnabled(changes[SETTINGS_KEY].newValue?.enabled !== false);
  });
}

function setWebToolsEnabled(enabled) {
  webToolsEnabled = enabled;
  if (!enabled) clearSelectionToolbar();
}

document.addEventListener('mouseup', () => {
  if (!webToolsEnabled) return;
  setTimeout(showSelectionToolbar, 0);
});

document.addEventListener('selectionchange', () => {
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.toString().trim().length < 2) {
      clearSelectionToolbar();
    }
  }, 0);
});

document.addEventListener('keyup', (event) => {
  if (!webToolsEnabled) return;
  if (event.key === 'Escape') clearSelectionToolbar();
  else showSelectionToolbar();
});

function showSelectionToolbar() {
  if (!webToolsEnabled) {
    clearSelectionToolbar();
    return;
  }
  const selection = window.getSelection();
  const text = selection?.toString().trim() || '';
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || text.length < 2) {
    clearSelectionToolbar();
    return;
  }
  if (selection.anchorNode && getToolbarHost()?.contains(selection.anchorNode)) return;

  selectedText = text.slice(0, 30000);
  selectedRange = selection.getRangeAt(0).cloneRange();
  const rect = selectedRange.getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  removeToolbar();
  const host = document.createElement('div');
  host.id = ROOT_ID;
  host.style.position = 'fixed';
  host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 360))}px`;
  host.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 52))}px`;
  host.style.zIndex = '2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .bar { display:flex; gap:3px; padding:5px; border:1px solid rgba(255,255,255,.15); border-radius:10px;
        background:#191923; color:#f4f4f5; box-shadow:0 8px 30px rgba(0,0,0,.35); font:12px/1.3 system-ui,sans-serif; }
      button { border:0; border-radius:7px; padding:7px 9px; color:inherit; background:transparent; cursor:pointer; }
      button:hover { background:#303044; } .primary { color:#c4b5fd; }
    </style>
    <div class="bar">
      <button data-action="explain">설명</button>
      <button data-action="translate">번역</button>
      <button data-action="ask">질문</button>
      <button class="primary" data-action="read">리더로 가져오기</button>
    </div>`;
  shadow.addEventListener('mousedown', (event) => event.preventDefault());
  shadow.addEventListener('click', handleToolbarClick);
  document.documentElement.appendChild(host);
}

async function handleToolbarClick(event) {
  if (!webToolsEnabled) {
    removeToolbar();
    return;
  }
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;
  const documentData = extractDocument();
  removeToolbar();
  // Mermaid output is sometimes rendered without recoverable source markup.
  // Capture only the selected rendered Mermaid as a temporary PNG; regular
  // Markdown and box/HTML blocks continue through the normal extractor.
  try {
    const diagramImage = '';
    if (diagramImage) {
      documentData.blocks.push({
        id: crypto.randomUUID(),
        order: documentData.blocks.length,
        kind: 'image',
        text: '화면에서 캡처한 다이어그램',
        markdown: `![화면에서 캡처한 다이어그램](${diagramImage})`,
      });
      documentData.diagnostics.push({ level: 'info', code: 'diagram-screenshot-fallback', message: '렌더링된 다이어그램을 화면 캡처 이미지로 보존했습니다.' });
    }
  } catch (error) {
    console.warn('SelvReader diagram capture:', error);
  }
  selectedText = '';
  selectedRange = null;
  try {
    const extensionApi = globalThis.chrome;
    const runtime = extensionApi && extensionApi.runtime;
    if (!runtime || !runtime.id || typeof runtime.sendMessage !== 'function') {
      showContentError('SelvReader가 업데이트되었습니다. 이 탭을 새로고침한 뒤 다시 시도하세요.');
      return;
    }
    runtime.sendMessage({
      type: 'CAPTURE_WEB_DOCUMENT',
      document: documentData,
      initialAction: action === 'read' ? '' : action,
    }, (response) => {
      try {
        const lastError = runtime.lastError;
        if (lastError) {
          const contextInvalidated = /extension context invalidated|message port closed|receiving end does not exist/i.test(lastError.message || '');
          showContentError(contextInvalidated
            ? 'SelvReader 연결이 갱신되었습니다. 이 ChatGPT/Gemini 탭을 새로고침해 주세요.'
            : `SelvReader 오류: ${lastError.message}`);
          return;
        }
        if (!response?.ok) {
          const message = response?.error || '리더로 내용을 전송하지 못했습니다.';
          console.warn('SelvReader:', message);
          showContentError(message);
        }
      } catch (callbackError) {
        console.warn('SelvReader:', callbackError);
        showContentError('SelvReader 연결이 갱신되었습니다. 이 ChatGPT/Gemini 탭을 새로고침해 주세요.');
      }
    });
  } catch (error) {
    const contextInvalidated = /extension context invalidated|cannot read propert|message port closed/i.test(String(error));
    const message = contextInvalidated
      ? 'SelvReader가 업데이트되었습니다. 이 탭을 새로고침한 뒤 다시 시도하세요.'
      : `SelvReader 오류: ${error instanceof Error ? error.message : String(error)}`;
    console.warn('SelvReader:', error);
    showContentError(message);
  }
}

function diagramCaptureTarget() {
  const element = selectedElement();
  const candidates = [
    element.closest?.('[data-testid*="mermaid"], [data-mermaid], .mermaid, .mermaid-chart'),
    element.closest?.('svg,canvas'),
  ].filter((candidate) => candidate instanceof Element);
  return candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width >= 40 && rect.height >= 30 && isRenderedMermaid(candidate);
  }) || null;
}

async function captureSelectedDiagramImage() {
  const target = diagramCaptureTarget();
  if (!target) return '';
  const rect = target.getBoundingClientRect();
  const padding = 6;
  const left = Math.max(0, rect.left - padding);
  const top = Math.max(0, rect.top - padding);
  const right = Math.min(window.innerWidth, rect.right + padding);
  const bottom = Math.min(window.innerHeight, rect.bottom + padding);
  if (right <= left || bottom <= top) return '';

  const response = await new Promise((resolve, reject) => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      reject(new Error('extension runtime unavailable'));
      return;
    }
    runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, (result) => {
      const lastError = runtime.lastError;
      if (lastError) reject(new Error(lastError.message));
      else if (!result?.ok || !result.dataUrl) reject(new Error(result?.error || 'screen capture failed'));
      else resolve(result.dataUrl);
    });
  });

  const image = await new Promise((resolve, reject) => {
    const loaded = new Image();
    loaded.onload = () => resolve(loaded);
    loaded.onerror = () => reject(new Error('captured image decode failed'));
    loaded.src = response;
  });
  const scaleX = image.naturalWidth / Math.max(1, window.innerWidth);
  const scaleY = image.naturalHeight / Math.max(1, window.innerHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((right - left) * scaleX));
  canvas.height = Math.max(1, Math.round((bottom - top) * scaleY));
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.drawImage(image, left * scaleX, top * scaleY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function showContentError(message) {
  document.getElementById('selvreader-error-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'selvreader-error-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    zIndex: '2147483647',
    right: '18px',
    bottom: '18px',
    maxWidth: '360px',
    padding: '12px 14px',
    border: '1px solid rgba(248, 113, 113, .45)',
    borderRadius: '10px',
    background: '#21181d',
    color: '#fecaca',
    boxShadow: '0 10px 30px rgba(0, 0, 0, .35)',
    font: '13px/1.5 system-ui, sans-serif',
  });
  document.documentElement.appendChild(toast);
  window.setTimeout(() => toast.remove(), 6000);
}

function extractDocument() {
  const source = detectSource();
  const root = findAnswerRoot(source);
  const diagnostics = [];
  const { citations, elementMap, urlMap } = extractCitations(root, source);
  activeCitationMap = elementMap;
  activeCitationByUrl = urlMap;
  const snapshot = createAnswerSnapshot(root, diagnostics);
  const blocks = extractBlocks(snapshot, diagnostics);
  activeCitationMap = null;
  activeCitationByUrl = null;
  if (blocks.length === 0) {
    blocks.push({ id: crypto.randomUUID(), order: 0, kind: 'paragraph', text: selectedText });
    diagnostics.push({ level: 'warning', code: 'answer-fallback-selection', message: '답변의 구조화된 블록을 찾지 못해 선택한 텍스트만 가져왔습니다.' });
  }
  diagnostics.push({ level: 'info', code: 'capture-summary', message: `답변 스냅샷에서 ${blocks.length}개 블록을 추출했습니다.` });
  return {
    schemaVersion: 2,
    source,
    sourceUrl: location.href,
    title: buildTitle(source, root),
    selectedText,
    blocks,
    citations,
    diagnostics,
  };
}

function findAnswerRoot(source) {
  if (source === 'chatgpt-answer') return findChatGptAnswerRoot();
  if (source === 'gemini-answer') return findGeminiAnswerRoot();
  return findGenericAnswerRoot();
}

// ChatGPT와 Gemini는 DOM 경계가 다르다. 아래 공통 탐색은 일반 웹 페이지에서만 쓴다.
function findGenericAnswerRoot() {
  if (!selectedRange) return document.body;
  let node = selectedRange.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!(node instanceof Element)) return document.body;

  const gemini = location.hostname.includes('gemini.google.com');
  const selectors = gemini
    ? [
        'model-response',
        '[data-test-id*="model-response"]',
        '[data-test-id*="response"]',
        '.model-response-text',
        'message-content',
        '[data-message-id]',
        'article',
        '[role="article"]',
      ]
    : [
        'article[data-testid^="conversation-turn-"]',
        '[data-testid^="conversation-turn-"]',
        '[data-message-author-role="assistant"]',
        '[data-testid="assistant-message"]',
        '[data-message-id]',
        '.agent-turn',
        'article',
        '[role="article"]',
        '.markdown',
      ];

  const candidates = [];
  for (const [priority, selector] of selectors.entries()) {
    const candidate = node.closest(selector);
    if (candidate && containsSelection(candidate)) candidates.push({ candidate, priority });
  }

  const explicit = candidates
    .filter(({ candidate }) => isSingleAnswerContainer(candidate, gemini))
    .sort((first, second) => answerRootScore(second.candidate, gemini) - answerRootScore(first.candidate, gemini)
      || first.priority - second.priority)[0]?.candidate;
  if (explicit) return explicit;

  // 사이트 DOM이 바뀐 경우에도 첫 문단에서 멈추지 않고, 같은 답변의 형제 블록을
  // 포함하는 가장 큰 컨테이너를 찾는다. 대화 전체나 페이지 전체는 제외한다.
  const fallback = [];
  let candidate = node;
  while (candidate && candidate !== document.body && candidate !== document.documentElement) {
    if (containsSelection(candidate) && isSingleAnswerContainer(candidate, gemini)) fallback.push(candidate);
    if (candidate.matches('main,[role="main"]')) break;
    candidate = candidate.parentElement;
  }
  return fallback.sort((first, second) => answerRootScore(second, gemini) - answerRootScore(first, gemini))[0] || node;
}

function selectedElement() {
  if (!selectedRange) return document.body;
  const node = selectedRange.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) return node.parentElement || document.body;
  return node instanceof Element ? node : document.body;
}

function findChatGptAnswerRoot() {
  const node = selectedElement();
  // Current ChatGPT transcript DOM: data-turn-key contains message units
  // identified by data-chatgpt-search-unit-key (...:user|assistant). Prefer
  // the complete assistant unit so a selection never truncates the answer.
  const modernAssistant = node.closest('[data-chatgpt-search-unit-key$=":assistant"]');
  if (modernAssistant && containsSelection(modernAssistant)) return modernAssistant;

  const modernTurn = node.closest('[data-turn-key]');
  if (modernTurn && containsSelection(modernTurn)) {
    const assistantUnits = [...modernTurn.querySelectorAll('[data-chatgpt-search-unit-key$=":assistant"]')]
      .filter((candidate) => containsSelection(candidate))
      .sort((first, second) => chatGptAnswerScore(second) - chatGptAnswerScore(first));
    if (assistantUnits[0]) return assistantUnits[0];
  }
  // ChatGPT는 assistant 메시지 자체를 가장 신뢰한다. turn/article 전체를 먼저 복제하면
  // 사용자의 질문까지 함께 들어갈 수 있으므로 반드시 assistant 경계를 우선한다.
  const direct = node.closest('[data-message-author-role="assistant"], [data-testid="assistant-message"]');
  if (direct && containsSelection(direct)) return direct;

  const turn = node.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]');
  const nested = turn
    ? [...turn.querySelectorAll('[data-message-author-role="assistant"], [data-testid="assistant-message"], .markdown')]
      .filter((candidate) => containsSelection(candidate))
      .sort((first, second) => chatGptAnswerScore(second) - chatGptAnswerScore(first))[0]
    : null;
  if (nested) return nested;

  const fallbacks = [];
  let candidate = node;
  while (candidate && candidate !== document.body && candidate !== document.documentElement) {
    if (containsSelection(candidate) && isChatGptAnswerContainer(candidate)) {
      fallbacks.push(candidate);
    }
    if (candidate.matches('main, [role="main"]')) break;
    candidate = candidate.parentElement;
  }
  return fallbacks.sort((first, second) => chatGptAnswerScore(second) - chatGptAnswerScore(first))[0] || node;
}

function isChatGptAnswerContainer(candidate) {
  if (!(candidate instanceof Element)) return false;
  const textLength = normalizePlainText(candidate.innerText || candidate.textContent || '').length;
  if (textLength < selectedText.length || textLength > 500000) return false;
  if (candidate.matches('[data-message-author-role="user"]')) return false;
  const userMessages = candidate.querySelectorAll('[data-message-author-role="user"]').length;
  const assistantMessages = candidate.querySelectorAll('[data-message-author-role="assistant"]').length;
  return !(userMessages > 0 && assistantMessages > 0) && assistantMessages <= 1;
}

function chatGptAnswerScore(candidate) {
  if (!(candidate instanceof Element)) return Number.NEGATIVE_INFINITY;
  const textLength = normalizePlainText(candidate.innerText || candidate.textContent || '').length;
  const blocks = candidate.querySelectorAll('p,pre,blockquote,table,ul,ol,h1,h2,h3,h4,h5,h6,figure').length;
  let score = Math.min(blocks, 80) * 25 + Math.min(Math.log2(Math.max(textLength, 2)) * 12, 220);
  if (candidate.matches('[data-message-author-role="assistant"], [data-testid="assistant-message"]')) score += 2000;
  if (candidate.matches('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]')) score += 600;
  if (candidate.matches('.markdown')) score += 400;
  return score;
}

function findGeminiAnswerRoot() {
  const node = selectedElement();
  // Gemini는 model-response 웹 컴포넌트가 응답 단위다. 내부 message-content만 잡으면
  // sources/표/렌더된 SVG가 잘릴 수 있으므로 host를 먼저 사용한다.
  const responseHost = node.closest('model-response, [data-test-id*="model-response"]');
  if (responseHost && containsSelection(responseHost)) return responseHost;

  const content = node.closest('message-content, .model-response-text, [data-test-id*="response-content"]');
  if (content && containsSelection(content)) {
    const host = content.closest('model-response, [data-test-id*="model-response"]');
    return host || content;
  }

  const fallbacks = [];
  let candidate = node;
  while (candidate && candidate !== document.body && candidate !== document.documentElement) {
    if (containsSelection(candidate) && isGeminiAnswerContainer(candidate)) fallbacks.push(candidate);
    if (candidate.matches('main, [role="main"], chat-window')) break;
    candidate = candidate.parentElement;
  }
  return fallbacks.sort((first, second) => geminiAnswerScore(second) - geminiAnswerScore(first))[0] || node;
}

function isGeminiAnswerContainer(candidate) {
  if (!(candidate instanceof Element)) return false;
  const textLength = normalizePlainText(candidate.innerText || candidate.textContent || '').length;
  if (textLength < selectedText.length || textLength > 500000) return false;
  if (candidate.matches('chat-window, main, [role="main"]')) return false;
  return candidate.querySelectorAll('model-response, [data-test-id*="model-response"]').length <= 1;
}

function geminiAnswerScore(candidate) {
  if (!(candidate instanceof Element)) return Number.NEGATIVE_INFINITY;
  const textLength = normalizePlainText(candidate.innerText || candidate.textContent || '').length;
  const blocks = candidate.querySelectorAll('p,pre,blockquote,table,ul,ol,h1,h2,h3,h4,h5,h6,figure').length;
  let score = Math.min(blocks, 80) * 25 + Math.min(Math.log2(Math.max(textLength, 2)) * 12, 220);
  if (candidate.matches('model-response, [data-test-id*="model-response"]')) score += 2000;
  if (candidate.matches('message-content, .model-response-text, [data-test-id*="response-content"]')) score += 1200;
  return score;
}

function containsSelection(candidate) {
  // Do not use rendered text as the primary containment check. KaTeX exposes
  // different strings through Selection, innerText and MathML annotations, so
  // a formula selected inside a complete answer often fails a text comparison.
  // The saved Range still points at the original DOM and is authoritative.
  if (selectedRange
    && candidate.contains(selectedRange.startContainer)
    && candidate.contains(selectedRange.endContainer)) {
    return true;
  }

  // Keep the text fallback for reconstructed/virtualized containers whose
  // original range nodes are no longer attached when extraction runs.
  const selected = normalizePlainText(selectedText).slice(0, 160);
  const content = normalizePlainText(candidate.innerText || candidate.textContent || '');
  if (!selected) return false;
  if (content.includes(selected)) return true;
  const words = selected.split(/\s+/).filter(Boolean).slice(0, 12);
  return words.length > 0 && words.filter((word) => content.includes(word)).length / words.length >= 0.75;
}

function isSingleAnswerContainer(candidate, gemini) {
  const textLength = normalizePlainText(candidate.innerText || candidate.textContent || '').length;
  if (textLength < selectedText.length || textLength > 500000) return false;
  const userMessages = candidate.querySelectorAll('[data-message-author-role="user"], user-query, [data-test-id*="user-query"]').length;
  const assistantMessages = candidate.querySelectorAll('[data-message-author-role="assistant"], model-response, [data-test-id*="model-response"]').length;
  if (userMessages > 0 && assistantMessages > 0) return false;
  if (assistantMessages > 1) return false;
  if (gemini && candidate.matches('chat-window, main, [role="main"]')) return false;
  return true;
}

function answerRootScore(candidate, gemini) {
  const textLength = normalizePlainText(candidate.innerText || candidate.textContent || '').length;
  const blockCount = candidate.querySelectorAll('p,pre,blockquote,table,ul,ol,h1,h2,h3,h4,h5,h6,figure').length;
  let score = Math.min(blockCount, 80) * 25 + Math.min(Math.log2(Math.max(textLength, 2)) * 12, 220);
  if (candidate.matches('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]')) score += 1200;
  if (candidate.matches('[data-message-author-role="assistant"], [data-testid="assistant-message"]')) score += 1000;
  if (gemini && candidate.matches('model-response, [data-test-id*="model-response"]')) score += 1200;
  if (gemini && candidate.matches('message-content, .model-response-text')) score += 850;
  if (candidate.matches('.markdown')) score += 500;
  if (blockCount <= 1 && textLength <= Math.max(400, selectedText.length * 2)) score -= 600;
  return score;
}

function createAnswerSnapshot(root, diagnostics) {
  const snapshot = root.cloneNode(true);
  snapshot.querySelectorAll('script,style,iframe,object,embed,form,input,textarea,select,dialog,[data-radix-popper-content-wrapper]').forEach((element) => element.remove());
  snapshot.querySelectorAll('[hidden],[aria-hidden="true"]').forEach((element) => {
    if (!element.closest('svg,math')) element.remove();
  });
  snapshot.querySelectorAll('button').forEach((button) => {
    if (!isCitationLike(button)) button.remove();
  });
  snapshot.querySelectorAll('a[href],img[src],source[src]').forEach((element) => {
    const attribute = element.matches('a') ? 'href' : 'src';
    const value = element.getAttribute(attribute);
    if (!value) return;
    try { element.setAttribute(attribute, new URL(value, location.href).href); } catch { element.removeAttribute(attribute); }
  });
  if (!snapshot.textContent?.trim() && !snapshot.querySelector('img,svg,table,pre')) {
    diagnostics.push({ level: 'warning', code: 'empty-answer-snapshot', message: '답변 스냅샷에 읽을 수 있는 콘텐츠가 없습니다.' });
  }
  return snapshot;
}

function isCitationLike(element) {
  return element.matches?.('[data-citation], [data-testid*="citation"], [data-testid*="source"], [class*="citation"]')
    || /(?:source|citation|출처)/i.test(element.getAttribute?.('aria-label') || '')
    || /^\[?\d+\]?$/.test(element.textContent?.trim() || '');
}

function extractBlocks(root, diagnostics) {
  const blocks = [];
  const visit = (element) => {
    if (!(element instanceof Element) || isIgnoredElement(element)) return;
    if (isBlockElement(element) || isRichVisualElement(element) || isLooseTextContainer(element)) {
      const block = elementToDocumentBlock(element, diagnostics, blocks.length);
      if (block) blocks.push(block);
      return;
    }
    for (const child of element.children) {
      visit(child);
      if (blocks.length >= 2000) return;
    }
  };
  visit(root);
  return blocks;
}

function isIgnoredElement(element) {
  return element.id === ROOT_ID
    || element.matches('script,style,noscript,template,button,[role="button"],nav,aside,footer,header,form')
    || Boolean(element.closest(`#${ROOT_ID}`));
}

function isBlockElement(element) {
  return element.matches('h1,h2,h3,h4,h5,h6,p,pre,blockquote,table,ul,ol,hr,figure,img,[data-code-block="true"],[data-markdown-copy="code-block"]')
    || isAnnotationBox(element)
    || (isMathElement(element) && isDisplayMath(element));
}

function isAnnotationBox(element) {
  if (element.tagName?.toLowerCase() !== 'span') return false;
  return element.matches?.('span[data-d-component="box"], span.Box-qIMv6G, span[class*="Box-"]')
    && normalizePlainText(element.innerText || element.textContent || '').length > 0;
}

function isRichVisualElement(element) {
  if (isRenderedMermaid(element)) return true;
  if (isStructuredDiagramContainer(element)) return true;
  if (element.matches('svg,canvas')) return true;
  return element.matches('div,section')
    && element.children.length > 0
    && !element.querySelector('p,pre,table,ul,ol,h1,h2,h3,h4,h5,h6')
    && Boolean(element.querySelector(':scope > svg,:scope > canvas'));
}

function isStructuredDiagramContainer(element) {
  const component = element.getAttribute?.('data-d-component');
  if (!component || !/^(box|grid|grid-item|row)$/i.test(component)) return false;
  // A box with SVG arrows/icons or nested layout boxes is a single diagram.
  // Keeping the outer container prevents the DOM walker from flattening it
  // into unrelated paragraphs and individual SVG blocks.
  return Boolean(element.querySelector('svg,canvas,[data-d-component="box"],[data-d-component="grid"]')
    || element.hasAttribute('data-d-has-border')
    || element.children.length > 2);
}

function isLooseTextContainer(element) {
  if (!element.matches('div,section,article')) return false;
  if (element.querySelector('h1,h2,h3,h4,h5,h6,p,pre,blockquote,table,ul,ol,hr,figure,img')) return false;
  if (element.querySelector('svg,canvas,math')) return false;
  const text = normalizePlainText(element.innerText || element.textContent || '');
  return text.length > 0 && text.length <= 100000;
}

function elementToDocumentBlock(element, diagnostics, order) {
  const kind = getBlockKind(element);
  if (kind === 'html') {
    const html = serializeRichFallback(element);
    if (!html) return null;
    diagnostics.push({ level: 'info', code: 'rich-html-fallback', message: '원본 형식으로 변환할 수 없는 시각 요소를 안전한 HTML/SVG 폴백으로 보존했습니다.' });
    return {
      id: crypto.randomUUID(), order, kind, text: normalizePlainText(element.textContent || '') || '시각 콘텐츠', html,
    };
  }
  const markdown = elementToBlockMarkdown(element, kind).trim();
  const text = kind === 'code' || kind === 'diagram'
    ? extractCodeText(element)
    : normalizePlainText(element.innerText || element.textContent || '')
      || (kind === 'image' ? element.getAttribute('alt') || element.querySelector('img')?.getAttribute('alt') || '이미지' : '')
      || (element.matches('hr') ? '구분선' : '');
  if (!markdown || (!text && kind !== 'math')) return null;
  return {
    id: crypto.randomUUID(), order, kind, text: text.slice(0, 100000), markdown: markdown.slice(0, 120000),
    language: kind === 'code' || kind === 'diagram' ? detectCodeLanguage(element) : undefined,
  };
}

function getBlockKind(element) {
  const tag = element.tagName.toLowerCase();
  if (element.matches('[data-code-block="true"],[data-markdown-copy="code-block"],[data-code-block-source]')) {
    return detectCodeLanguage(element) === 'mermaid' ? 'diagram' : 'code';
  }
  if (isRenderedMermaid(element)) return extractMermaidSource(element) ? 'diagram' : 'html';
  if (isAnnotationBox(element)) return 'annotation';
  if (isStructuredDiagramContainer(element)) return 'box';
  if (tag === 'svg' || tag === 'canvas') return 'html';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'pre') return detectCodeLanguage(element) === 'mermaid' ? 'diagram' : 'code';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'table') return isSimpleTable(element) ? 'table' : 'html';
  if (tag === 'ul' || tag === 'ol') return 'list';
  if (tag === 'figure' || tag === 'img') return 'image';
  if (isDisplayMath(element)) return 'math';
  return 'paragraph';
}

function detectCodeLanguage(element) {
  const code = element.querySelector('code, .cm-content, [data-editor-search-surface] [contenteditable="true"]');
  const className = code?.className || '';
  const explicit = className.match(/(?:language-|lang-)([\w-]+)/)?.[1];
  if (explicit) return explicit.toLowerCase() === 'mermaid' ? 'mermaid' : explicit.toLowerCase();
  const declared = code?.getAttribute('data-language')
    || element.getAttribute('data-language')
    || element.getAttribute('data-code-language')
    || element.querySelector?.('[data-language]')?.getAttribute('data-language')
    || element.closest('code-block')?.getAttribute('language');
  if (declared) return declared.toLowerCase();
  const codeText = extractCodeText(element);
  if (looksLikeMermaid(codeText)) return 'mermaid';
  const label = element.querySelector?.('[data-markdown-copy="exclude"]')?.textContent?.trim()
    || element.parentElement?.querySelector('[class*="language"], [class*="header"]')?.textContent?.trim()
    || '';
  const known = label.match(/\b(python|javascript|typescript|java|c\+\+|cpp|c#|csharp|go|rust|ruby|php|swift|kotlin|sql|bash|shell|json|yaml|xml|html|css|markdown|text)\b/i)?.[1];
  if (known) return known.toLowerCase().replace('c++', 'cpp').replace('c#', 'csharp');
  if (/^\s*(?:from\s+\w+\s+import|import\s+\w+|def\s+\w+\s*\(|class\s+\w+\s*[:(]|@\w+)/m.test(codeText)) return 'python';
  if (/^\s*(?:const|let|var)\s+\w+\s*=|(?:function|console\.log)\s*\(/m.test(codeText)) return 'javascript';
  return '';
}

function extractCodeText(element) {
  const source = element.matches?.('[data-code-block-source]')
    ? element
    : element.querySelector?.('[data-code-block-source]') || element;
  const code = source.matches?.('code, .cm-content, [data-editor-search-surface] [contenteditable="true"]')
    ? source
    : source.querySelector?.('code, pre > code, .cm-content, [data-editor-search-surface] [contenteditable="true"]');
  const lineTexts = extractCodeLines(source, code);
  // ChatGPT frequently represents source lines as nested spans without literal
  // line-feed characters. Prefer those line containers even when innerText has
  // already flattened the same source into a single line.
  const rawCode = code?.textContent || '';
  // textContent preserves the original newline characters inside a single
  // ChatGPT span. innerText may collapse them when the source is off-screen
  // or its white-space style has not been applied yet.
  let value = lineTexts.length > 1
    ? lineTexts.join('\n')
    : rawCode.includes('\n') ? rawCode : code?.innerText || rawCode || source.innerText || source.textContent || '';
  // A flattened fallback can include ChatGPT's visual language badge before
  // the source. It is UI chrome, not part of the program.
  const languageLabel = source.closest?.('[data-code-block="true"], [data-markdown-copy="code-block"]')
    ?.querySelector?.('[data-markdown-copy="exclude"]')?.textContent?.trim();
  if (languageLabel && !code && value.startsWith(languageLabel)) value = value.slice(languageLabel.length);
  return value.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

function extractCodeLines(source, code) {
  const roots = [code, source].filter((root, index, values) => root && values.indexOf(root) === index);
  const selectors = [
    ':scope > .cm-line',
    ':scope > span > span',
    ':scope > span > div',
    ':scope > div',
    '[data-line-number] + span',
    '[data-code-line]',
  ];
  for (const root of roots) {
    for (const selector of selectors) {
      let nodes = [];
      try { nodes = [...root.querySelectorAll(selector)]; } catch { continue; }
      const lines = nodes.map((line) => line.textContent || '');
      // Empty spans are meaningful: they represent blank lines. Do not drop
      // them, but require at least two actual line containers to avoid using
      // syntax-highlight token spans as lines.
      if (lines.length > 1 && lines.some((line) => /\S/.test(line))) return lines;
    }
  }
  return [];
}

function looksLikeMermaid(value) {
  return /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|journey|mindmap|timeline|gitGraph|pie(?:\s+title)?|quadrantChart|requirementDiagram|C4Context|C4Container|sankey-beta)\b/im.test(value || '');
}

function elementToBlockMarkdown(element, kind) {
  if (element.matches('hr')) return '---';
  if (isRenderedMermaid(element)) {
    const source = extractMermaidSource(element);
    return source ? `\`\`\`mermaid\n${source}\n\`\`\`` : '';
  }
  if (kind === 'code' || kind === 'diagram') {
    const language = detectCodeLanguage(element);
    const code = extractCodeText(element);
    const fence = code.includes('```') ? '````' : '```';
    return `${fence}${language}\n${code}\n${fence}`;
  }
  if (kind === 'box') return boxToMarkdown(element);
  if (kind === 'annotation') return annotationToMarkdown(element);
  if (kind === 'table') return tableToMarkdown(element);
  if (kind === 'list') return listToMarkdown(element, 0).trimEnd();
  if (kind === 'math') {
    const latex = extractLatex(element);
    return latex ? `$$\n${latex}\n$$` : inlineNodesToMarkdown(element.childNodes).trim();
  }
  const inline = inlineNodesToMarkdown(element.childNodes).trim();
  if (kind === 'heading') {
    const level = Number(element.tagName.slice(1)) || 2;
    return `${'#'.repeat(level)} ${inline}`;
  }
  if (kind === 'quote') return inline.split('\n').map((line) => `> ${line}`).join('\n');
  return inline;
}

function annotationToMarkdown(element) {
  const text = inlineNodesToMarkdown(element.childNodes).trim();
  return text ? `> [!IMPORTANT] 주석\n>\n> ${text}` : '';
}

function boxToMarkdown(element) {
  const lines = structuredBoxLines(element);
  if (!lines.length) return normalizePlainText(element.innerText || element.textContent || '');
  return [
    '> [!NOTE] 시각화 요약',
    '>',
    ...lines.map((line) => `> ${line}`),
  ].join('\n');
}

function structuredBoxLines(root) {
  const lines = [];
  const push = (value, depth) => {
    const text = normalizePlainText(value || '');
    if (!text || text === '→' || text === '↓' || text === '↔') return;
    const previous = lines.at(-1)?.replace(/^\s*-\s*/, '');
    if (previous === text) return;
    lines.push(`${'  '.repeat(Math.min(depth, 4))}- ${text}`);
  };
  const visit = (node, depth) => {
    for (const child of node.children || []) {
      if (child.matches?.('svg,canvas,button,[aria-hidden="true"]')) continue;
      const structural = child.matches?.('[data-d-component="box"], [data-d-component="grid"], [data-d-component="grid-item"], [data-d-component="row"]');
      if (structural) {
        const directText = [...child.childNodes]
          .filter((part) => part.nodeType === Node.TEXT_NODE)
          .map((part) => part.textContent || '').join('');
        push(directText, depth);
        visit(child, depth + 1);
        continue;
      }
      if (child.querySelector?.('[data-d-component="box"], [data-d-component="grid"], [data-d-component="grid-item"], [data-d-component="row"]')) {
        visit(child, depth);
      } else {
        push(child.innerText || child.textContent || '', depth);
      }
    }
  };
  visit(root, 0);
  return lines;
}

function inlineNodesToMarkdown(nodes) {
  return [...nodes].map(nodeToMarkdown).join('');
}

function nodeToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeMarkdownText(node.nodeValue || '');
  if (!(node instanceof Element)) return '';
  if (node.closest(`#${ROOT_ID}`)) return '';

  const citation = activeCitationMap?.get(node) || citationForUrl(node);
  if (citation) return `[${citation.label}](selvreader-citation:${encodeURIComponent(citation.id)})`;

  if (node.matches('style,script')) return '';
  if (isRenderedMermaid(node)) {
    const source = extractMermaidSource(node);
    return source ? `\n\`\`\`mermaid\n${source}\n\`\`\`\n` : '';
  }

  const latex = extractLatex(node);
  if (latex && isMathElement(node)) return isDisplayMath(node) ? `\n$$\n${latex}\n$$\n` : `$${latex}$`;

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '  \n';
  if (tag === 'strong' || tag === 'b') return wrapInline('**', inlineNodesToMarkdown(node.childNodes));
  if (tag === 'em' || tag === 'i') return wrapInline('*', inlineNodesToMarkdown(node.childNodes));
  if (tag === 'del' || tag === 's' || tag === 'strike') return wrapInline('~~', inlineNodesToMarkdown(node.childNodes));
  if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
    const value = node.textContent || '';
    const fence = value.includes('`') ? '``' : '`';
    return `${fence}${value}${fence}`;
  }
  if (tag === 'a') {
    const label = inlineNodesToMarkdown(node.childNodes).trim() || node.textContent?.trim() || '';
    const href = node.getAttribute('href') || '';
    return href && !href.toLowerCase().startsWith('javascript:') ? `[${label}](${escapeMarkdownUrl(href)})` : label;
  }
  if (tag === 'img') {
    const src = node.getAttribute('src') || '';
    const alt = (node.getAttribute('alt') || '이미지').replace(/\]/g, '\\]');
    return src && !src.toLowerCase().startsWith('javascript:') ? `![${alt}](${escapeMarkdownUrl(src)})` : '';
  }
  if (tag === 'ul' || tag === 'ol') return `\n${listToMarkdown(node, 0)}\n`;
  return inlineNodesToMarkdown(node.childNodes);
}

function citationForUrl(element) {
  if (!element.matches?.('a[href]') || !activeCitationByUrl) return null;
  try { return activeCitationByUrl.get(new URL(element.getAttribute('href'), location.href).href) || null; } catch { return null; }
}

function wrapInline(marker, value) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  return `${value.match(/^\s*/)?.[0] || ''}${marker}${trimmed}${marker}${value.match(/\s*$/)?.[0] || ''}`;
}

function listToMarkdown(list, depth) {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const items = [...list.children].filter((child) => child.tagName.toLowerCase() === 'li');
  return items.map((item, index) => {
    const content = [...item.childNodes]
      .filter((node) => !(node instanceof Element && /^(ul|ol)$/i.test(node.tagName)))
      .map(nodeToMarkdown).join('').trim().replace(/\n+/g, ' ');
    const checkbox = item.querySelector(':scope > input[type="checkbox"]');
    const marker = ordered ? `${index + 1}.` : '-';
    const task = checkbox ? `[${checkbox.checked ? 'x' : ' '}] ` : '';
    const line = `${'  '.repeat(depth)}${marker} ${task}${content}`;
    const nested = [...item.children]
      .filter((child) => /^(ul|ol)$/i.test(child.tagName))
      .map((child) => listToMarkdown(child, depth + 1)).join('\n');
    return nested ? `${line}\n${nested}` : line;
  }).join('\n');
}

function tableToMarkdown(table) {
  const rows = [...table.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll(':scope > th, :scope > td')].map((cell) =>
      inlineNodesToMarkdown(cell.childNodes).trim().replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|')))
    .filter((row) => row.some((cell) => cell.length > 0));
  if (!rows.length) return normalizePlainText(table.innerText || '');
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
  const header = normalized[0];
  const body = normalized.slice(1);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function isSimpleTable(table) {
  const rows = [...table.querySelectorAll('tr')];
  return rows.length > 0 && rows.every((row) => [...row.querySelectorAll(':scope > th,:scope > td')]
    .every((cell) => Number(cell.getAttribute('colspan') || '1') === 1
      && Number(cell.getAttribute('rowspan') || '1') === 1
      && !cell.querySelector('table,ul,ol,pre')));
}

function serializeRichFallback(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll?.('script,style,iframe,object,embed,foreignObject').forEach((child) => child.remove());
  clone.querySelectorAll?.('*').forEach((child) => {
    const insideSvg = child instanceof SVGElement || Boolean(child.closest('svg'));
    const structural = child.matches?.('[data-d-component="box"],[data-d-component="grid"],[data-d-component="grid-item"],[data-d-component="row"]');
    for (const attribute of [...child.attributes]) {
      if (/^on/i.test(attribute.name) || /^data-reactroot$/i.test(attribute.name)) child.removeAttribute(attribute.name);
      if (!insideSvg && /^(class|id)$/i.test(attribute.name)) child.removeAttribute(attribute.name);
      if (!insideSvg && attribute.name === 'style' && !structural) child.removeAttribute(attribute.name);
      if (attribute.name === 'style' && /(?:javascript:|expression\s*\(|url\s*\()/i.test(attribute.value)) child.removeAttribute(attribute.name);
      if (/^(href|src|xlink:href)$/i.test(attribute.name) && /^(javascript:|data:text\/html)/i.test(attribute.value.trim())) child.removeAttribute(attribute.name);
    }
  });
  const standaloneSvg = clone.matches?.('svg') ? clone : clone.querySelector?.(':scope > svg');
  return (standaloneSvg?.outerHTML || clone.outerHTML).slice(0, 200000);
}

function extractLatex(element) {
  return element.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    || element.getAttribute?.('data-math')
    || element.getAttribute?.('data-latex')
    || element.getAttribute?.('data-formula')
    || element.getAttribute?.('data-equation')
    || (element.matches?.('math-formula, .math, .math-block, .katex') ? element.getAttribute('aria-label') : '')
    || '';
}

function isMathElement(element) {
  // Only identify the actual math host. Checking for a descendant annotation
  // here makes every answer container that contains one formula look like a
  // single math block, causing the block walker to stop at the answer root.
  return element.matches?.('math, math-formula, .math, .math-block, .katex, .katex-display, [data-d-component="math"], [data-math-display], [data-math], [data-latex], [data-formula], [data-equation]');
}

function isDisplayMath(element) {
  return element.matches?.('.math-block, .katex-display, math[display="block"], [data-d-block], [data-math-display="true"]')
    || Boolean(element.querySelector?.(':scope > .katex-display, :scope > math[display="block"]'));
}

function escapeMarkdownText(value) {
  return value.replace(/([\\`*_[\]{}()#+\-.!<>$])/g, '\\$1');
}

function escapeMarkdownUrl(value) {
  return value.replace(/\s/g, '%20').replace(/\)/g, '%29');
}

function normalizePlainText(value) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isRenderedMermaid(element) {
  return element.matches?.('[data-testid*="mermaid"], [data-mermaid], .mermaid, .mermaid-chart')
    || Boolean(element.querySelector?.('svg[id*="mermaid"], svg[aria-roledescription*="flowchart"], svg[aria-roledescription*="diagram"]'));
}

function extractMermaidSource(element) {
  const code = element.matches?.('pre') ? element.querySelector('code') : element.querySelector?.('pre code.language-mermaid, code.language-mermaid');
  const embedded = element.querySelector?.('script[type="text/mermaid"], textarea[data-mermaid], [data-mermaid-source]');
  const declared = element.getAttribute?.('data-mermaid')
    || element.getAttribute?.('data-source')
    || element.getAttribute?.('data-code')
    || embedded?.getAttribute?.('data-mermaid-source')
    || embedded?.textContent
    || code?.textContent;
  if (declared?.trim()) return declared.trim();
  const raw = extractCodeText(element);
  if (looksLikeMermaid(raw)) return raw;
  const container = element.closest?.('[data-testid*="mermaid"], [class*="mermaid"]')?.parentElement;
  const siblingCode = container?.querySelector('pre code.language-mermaid, code.language-mermaid')?.textContent?.trim() || '';
  return siblingCode || (looksLikeMermaid(container?.textContent || '') ? container.textContent.trim() : '');
}

function extractCitations(root, source) {
  const citations = [];
  const elementMap = new WeakMap();
  const urlMap = new Map();
  if (source !== 'chatgpt-answer' && source !== 'gemini-answer') return { citations, elementMap, urlMap };

  const candidates = [...root.querySelectorAll([
    'citation-source',
    '[data-test-id*="source"]',
    '[data-test-id*="citation"]',
    'a[href]',
    '[data-citation]',
    '[data-testid*="citation"]',
    '[data-testid*="source"]',
    'button[aria-label*="source" i]',
    'button[aria-label*="citation" i]',
    'button[aria-label*="출처"]',
  ].join(','))];
  const byUrl = new Map();
  for (const element of candidates) {
    const link = element.matches('a[href]') ? element : element.querySelector('a[href]');
    const rawUrl = link?.getAttribute('href')
      || element.getAttribute('data-url')
      || element.getAttribute('data-href')
      || '';
    const isFootnote = rawUrl.startsWith('#') && Boolean(element.closest('sup, [data-footnote-ref]'));
    let url = '';
    try { url = new URL(rawUrl, location.href).href; } catch { continue; }
    if (!/^https?:/i.test(url) || (!isFootnote && new URL(url).hostname === location.hostname)) continue;

    const marker = element.matches('[data-citation], [data-testid*="citation"], [data-testid*="source"], [data-test-id*="citation"], [data-test-id*="source"], citation-source, [class*="citation"], sup, button')
      || Boolean(element.closest('[data-citation], [data-testid*="citation"], [data-testid*="source"], [data-test-id*="citation"], [data-test-id*="source"], citation-source, [class*="citation"], sup'))
      || /^\[?\d+\]?$/.test(element.textContent?.trim() || '');
    if (!marker) continue;

    let citation = byUrl.get(url);
    if (!citation) {
      const number = citations.length + 1;
      const host = new URL(url).hostname.replace(/^www\./, '');
      const footnoteTarget = isFootnote ? document.getElementById(decodeURIComponent(rawUrl.slice(1))) : null;
      const title = cleanCitationText((isFootnote ? `각주 ${element.textContent?.trim() || number}` : '')
        || element.getAttribute('data-title')
        || link?.getAttribute('title')
        || element.getAttribute('aria-label')
        || link?.textContent
        || host, 180);
      const card = element.closest('[data-testid*="source"], [data-testid*="citation"], li');
      const snippet = cleanCitationText(footnoteTarget?.textContent
        || element.getAttribute('data-snippet') || card?.textContent || '', 360)
        .replace(/↩|Back to content/gi, '').trim();
      citation = { id: `source-${number}`, label: String(number), title: title || host, url, hostname: host, snippet,
        kind: isFootnote ? 'footnote' : 'citation' };
      citations.push(citation);
      byUrl.set(url, citation);
      urlMap.set(url, citation);
    }
    elementMap.set(element, citation);
    if (link) elementMap.set(link, citation);
  }
  return { citations, elementMap, urlMap };
}

function cleanCitationText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function detectSource() {
  if (location.hostname.includes('gemini.google.com')) return 'gemini-answer';
  if (location.hostname.includes('chatgpt.com') || location.hostname.includes('chat.openai.com')) return 'chatgpt-answer';
  return 'web-selection';
}

function buildTitle(source, root) {
  const heading = root.querySelector('h1,h2,h3')?.textContent?.trim();
  if (heading) return heading.slice(0, 180);
  const label = source === 'gemini-answer' ? 'Gemini 답변' : source === 'chatgpt-answer' ? 'ChatGPT 답변' : '웹 콘텐츠';
  return `${label} · ${new Date().toLocaleString('ko-KR')}`;
}

function getToolbarHost() {
  return document.getElementById(ROOT_ID);
}

function removeToolbar() {
  getToolbarHost()?.remove();
}

function clearSelectionToolbar() {
  removeToolbar();
  selectedText = '';
  selectedRange = null;
}
