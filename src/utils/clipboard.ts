import DOMPurify from 'dompurify';
import type { DocumentBlock, DocumentCitation, DocumentDiagnostic, WebDocument } from './extension';

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,pre,blockquote,ul,ol,table,hr,figure,img,[data-code-block="true"],[data-markdown-copy="code-block"]';

export async function documentFromClipboard(data: DataTransfer): Promise<WebDocument> {
  const html = data.getData('text/html');
  const suppliedMarkdown = data.getData('text/markdown');
  const plain = data.getData('text/plain');
  const diagnostics: DocumentDiagnostic[] = [];
  const blocks: DocumentBlock[] = [];
  let citations: DocumentCitation[] = [];
  const selvReaderRoundTrip = /data-selvreader-document(?:=|\s|>)/i.test(html);

  if (html && !selvReaderRoundTrip) {
    const unsafe = /<(script|iframe|object|embed|form|input|button)\b|\son\w+\s*=/i.test(html);
    const sanitized = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea'],
      FORBID_ATTR: ['srcdoc'],
      ALLOW_DATA_ATTR: true,
    });
    if (unsafe) diagnostics.push({ level: 'warning', code: 'unsafe-html-removed', message: '위험한 HTML 태그 또는 이벤트 속성을 제거했습니다.' });
    blocks.push(...blocksFromHtml(sanitized, diagnostics));
    const inspected = inspectHtml(sanitized);
    citations = inspected.citations;
    if (inspected.missingImages) diagnostics.push({
      level: 'warning', code: 'image-source-missing',
      message: `원본 데이터가 없거나 안전하지 않은 이미지 ${inspected.missingImages}개는 대체 이미지를 만들지 않고 제외했습니다.`,
    });
    diagnostics.push({ level: 'info', code: 'clipboard-html', message: '클립보드 HTML 구조를 우선 분석했습니다.' });
  } else if (suppliedMarkdown || plain) {
    const source = suppliedMarkdown || plain;
    const { markdown, repairs } = normalizeMarkdown(source);
    diagnostics.push(...repairs);
    blocks.push(makeBlock('paragraph', markdown, markdown));
    diagnostics.push({
      level: 'info',
      code: suppliedMarkdown ? 'clipboard-markdown' : 'clipboard-text',
      message: suppliedMarkdown ? '클립보드 Markdown을 가져왔습니다.' : '일반 텍스트를 Markdown으로 해석했습니다.',
    });
    if (selvReaderRoundTrip) diagnostics.push({
      level: 'info', code: 'round-trip-source-restored',
      message: 'SelvReader 복사본의 원본 Markdown·LaTeX·Mermaid 소스를 복원했습니다.',
    });
  }

  const imageFiles = [...data.files].filter((file) => file.type.startsWith('image/'));
  for (const [index, file] of imageFiles.entries()) {
    const url = await fileToDataUrl(file);
    blocks.push(makeBlock('image', file.name || `클립보드 이미지 ${index + 1}`, `![${escapeInline(file.name || `클립보드 이미지 ${index + 1}`)}](${url})`));
  }
  if (imageFiles.length) diagnostics.push({ level: 'info', code: 'clipboard-images', message: `클립보드 이미지 ${imageFiles.length}개를 포함했습니다.` });
  if (!blocks.length) throw new Error('붙여넣을 텍스트, HTML 또는 이미지가 없습니다.');

  const now = Date.now();
  const titleText = blocks.find((block) => block.kind === 'heading')?.text
    || plain.split(/\r?\n/).find((line) => line.trim())
    || '붙여넣은 AI 답변';
  return {
    id: crypto.randomUUID(),
    source: detectSource(html),
    title: titleText.replace(/^#+\s*/, '').trim().slice(0, 100),
    blocks: blocks.map((block, order) => ({ ...block, order })),
    citations,
    diagnostics,
    createdAt: now,
    updatedAt: now,
  };
}

function blocksFromHtml(html: string, diagnostics: DocumentDiagnostic[]): DocumentBlock[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const roots = collectBlockRoots(parsed.body);
  const usable = roots.length ? roots : [...parsed.body.children];
  const blocks: DocumentBlock[] = [];
  for (const element of usable) {
    const markdown = elementToMarkdown(element).trim();
    const text = (element.textContent || element.getAttribute('alt') || '').trim();
    if (!markdown) continue;
    const tag = element.tagName.toLowerCase();
    const codeContainer = element.matches('[data-code-block="true"],[data-markdown-copy="code-block"]');
    const codeSource = codeContainer ? extractClipboardCode(element) : '';
    const kind: DocumentBlock['kind'] = codeContainer ? (looksLikeMermaid(codeSource) ? 'diagram' : 'code')
      : /^h[1-6]$/.test(tag) ? 'heading'
      : tag === 'pre' ? (/language-mermaid|\bmermaid\b/i.test(element.querySelector('code')?.className || '') ? 'diagram' : 'code')
        : tag === 'table' ? 'table' : tag === 'blockquote' ? 'quote'
          : tag === 'ul' || tag === 'ol' ? 'list' : tag === 'img' || tag === 'figure' ? 'image' : 'paragraph';
    blocks.push(makeBlock(kind, text || markdown, markdown));
  }
  if (!blocks.length && parsed.body.textContent?.trim()) {
    const value = normalizeText(parsed.body.textContent);
    blocks.push(makeBlock('paragraph', value, escapeParagraph(value)));
    diagnostics.push({ level: 'warning', code: 'html-structure-fallback', message: 'HTML 블록 구조를 찾지 못해 일반 텍스트로 복구했습니다.' });
  }
  return blocks;
}

function collectBlockRoots(container: Element): Element[] {
  const result: Element[] = [];
  for (const child of container.children) {
    if (child.matches(BLOCK_SELECTOR)) result.push(child);
    else result.push(...collectBlockRoots(child));
  }
  return result;
}

function elementToMarkdown(element: Element, depth = 0): string {
  const tag = element.tagName.toLowerCase();
  if (element.matches('[data-code-block="true"],[data-markdown-copy="code-block"]')) {
    const raw = extractClipboardCode(element);
    const label = element.querySelector('[data-markdown-copy="exclude"]')?.textContent || '';
    const declared = element.getAttribute('data-language') || element.querySelector('code')?.getAttribute('data-language') || '';
    const named = label.match(/\b(python|javascript|typescript|java|c\+\+|cpp|c#|csharp|go|rust|ruby|php|swift|kotlin|sql|bash|shell|json|yaml|xml|html|css|markdown|text)\b/i)?.[1] || '';
    const language = /language-mermaid|\bmermaid\b/i.test(element.querySelector('code')?.className || '') || looksLikeMermaid(raw)
      ? 'mermaid' : (declared || named || /^\s*(?:from\s+\w+\s+import|import\s+\w+|def\s+\w+\s*\(|class\s+\w+\s*[:(])/m.test(raw) ? (declared || named || 'python') : 'text');
    return `\`\`\`${language}\n${raw}\n\`\`\``;
  }
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineChildren(element)}`;
  if (tag === 'p') return inlineChildren(element);
  if (tag === 'hr') return '---';
  if (tag === 'img') return imageMarkdown(element as HTMLImageElement);
  if (tag === 'figure') {
    const image = element.querySelector('img');
    const caption = element.querySelector('figcaption')?.textContent?.trim();
    return `${image ? imageMarkdown(image) : ''}${caption ? `\n\n*${escapeInline(caption)}*` : ''}`;
  }
  if (tag === 'pre') {
    const code = element.querySelector('code');
    const raw = code?.textContent || element.textContent || '';
    const language = [...(code?.classList || [])].find((name) => name.startsWith('language-'))?.slice(9)
      || (element.classList.contains('mermaid') ? 'mermaid' : 'text');
    return `\`\`\`${language}\n${raw.replace(/\n$/, '')}\n\`\`\``;
  }
  if (tag === 'blockquote') return inlineChildren(element).split('\n').map((line) => `> ${line}`).join('\n');
  if (tag === 'ul' || tag === 'ol') {
    return [...element.children].filter((child) => child.tagName.toLowerCase() === 'li').map((item, index) => {
      const clone = item.cloneNode(true) as Element;
      clone.querySelectorAll(':scope > ul,:scope > ol').forEach((nested) => nested.remove());
      const prefix = tag === 'ol' ? `${index + 1}.` : '-';
      const nested = [...item.children].filter((child) => /^(UL|OL)$/.test(child.tagName))
        .map((child) => elementToMarkdown(child, depth + 1).split('\n').map((line) => `  ${line}`).join('\n')).join('\n');
      return `${'  '.repeat(depth)}${prefix} ${inlineChildren(clone)}${nested ? `\n${nested}` : ''}`;
    }).join('\n');
  }
  if (tag === 'table') return tableMarkdown(element as HTMLTableElement);
  return inlineChildren(element);
}

function inlineChildren(element: Element): string {
  return [...element.childNodes].map((node) => inlineNode(node)).join('').replace(/[ \t]+\n/g, '\n').trim();
}

function extractClipboardCode(element: Element): string {
  const source = element.querySelector('[data-code-block-source]') || element;
  const code = source.matches('code') ? source : source.querySelector('code');
  let value = (code as HTMLElement | null)?.innerText || code?.textContent || source.textContent || '';
  if (!value.includes('\n')) {
    const lines = [...source.querySelectorAll('code > span > span, pre > code > span > span, :scope > span > span')]
      .map((line) => line.textContent || '');
    if (lines.length > 1) value = lines.join('\n');
  }
  return value.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

function looksLikeMermaid(value: string): boolean {
  return /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|journey|mindmap|timeline|gitGraph|pie(?:\s+title)?|quadrantChart|requirementDiagram|C4Context|C4Container|sankey-beta)\b/im.test(value);
}

function inlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return normalizeText(node.textContent || '').replace(/([\\`*_[\]])/g, '\\$1');
  if (!(node instanceof Element)) return '';
  const tag = node.tagName.toLowerCase();
  const content = [...node.childNodes].map(inlineNode).join('');
  if (tag === 'br') return '\n';
  if (tag === 'strong' || tag === 'b') return `**${content.trim()}**`;
  if (tag === 'em' || tag === 'i') return `*${content.trim()}*`;
  if (tag === 'del' || tag === 's') return `~~${content.trim()}~~`;
  if (tag === 'code') return `\`${(node.textContent || '').replace(/`/g, '\\`')}\``;
  if (tag === 'a') {
    const href = safeUrl(node.getAttribute('href') || '');
    return href ? `[${content || href}](${href})` : content;
  }
  if (tag === 'img') return imageMarkdown(node as HTMLImageElement);
  if (tag === 'sup' && /^\d+$/.test(content.trim())) return `[^${content.trim()}]`;
  if (tag === 'p' || tag === 'div') return `${content}\n`;
  return content;
}

function tableMarkdown(table: HTMLTableElement): string {
  const rows = [...table.rows].map((row) => [...row.cells].map((cell) =>
    normalizeText(cell.textContent || '').replace(/\|/g, '\\|').replace(/\n+/g, ' '),
  )).filter((row) => row.some((cell) => cell.length > 0));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const normalize = (row: string[]) => [...row, ...Array(Math.max(0, width - row.length)).fill('')];
  const header = normalize(rows[0]);
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${normalize(row).join(' | ')} |`)].join('\n');
}

export function normalizeMarkdown(input: string): { markdown: string; repairs: DocumentDiagnostic[] } {
  const repairs: DocumentDiagnostic[] = [];
  let markdown = normalizeText(input).replace(/\n{4,}/g, '\n\n\n');
  const fences = markdown.match(/^```/gm)?.length || 0;
  if (fences % 2) {
    markdown += '\n```';
    repairs.push({ level: 'warning', code: 'code-fence-repaired', message: '닫히지 않은 코드 블록을 복구했습니다.' });
  }
  const lines = markdown.split('\n');
  recoverFlattenedTable(lines, repairs);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (looksLikeTableRow(lines[index]) && looksLikeTableRow(lines[index + 1]) && !isTableSeparator(lines[index + 1])) {
      const cells = lines[index].split('|').filter((cell) => cell.trim()).length;
      lines.splice(index + 1, 0, `| ${Array(Math.max(1, cells)).fill('---').join(' | ')} |`);
      repairs.push({ level: 'warning', code: 'table-separator-repaired', message: '누락된 Markdown 표 머리 구분선을 복구했습니다.' });
      break;
    }
  }
  return { markdown: lines.join('\n').trim(), repairs };
}

function inspectHtml(html: string): { citations: DocumentCitation[]; missingImages: number } {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const byUrl = new Map<string, DocumentCitation>();
  for (const anchor of parsed.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = safeUrl(anchor.getAttribute('href') || '');
    if (!/^https?:/i.test(url) || byUrl.has(url)) continue;
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { /* URL is already filtered; keep empty host as fallback. */ }
    const number = byUrl.size + 1;
    byUrl.set(url, {
      id: `clipboard-source-${number}`,
      label: String(number),
      title: normalizeText(anchor.textContent || '').trim() || hostname || url,
      url,
      hostname,
      kind: anchor.closest('sup') ? 'footnote' : 'citation',
    });
  }
  const missingImages = [...parsed.querySelectorAll<HTMLImageElement>('img')]
    .filter((image) => !safeImageUrl(image.getAttribute('src') || '')).length
    + parsed.querySelectorAll('canvas').length;
  return { citations: [...byUrl.values()], missingImages };
}

function recoverFlattenedTable(lines: string[], repairs: DocumentDiagnostic[]) {
  for (let start = 0; start < lines.length; start += 1) {
    if (!/^\s*\|\s*\|\s*$/.test(lines[start]) || !/^\s*\|\s*:?-+:?\s*\|\s*$/.test(lines[start + 1] || '')) continue;
    let end = start + 2;
    const cells: string[] = [];
    while (end < lines.length && /^\s*\|[^|]*\|\s*$/.test(lines[end])) {
      const value = lines[end].replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim();
      if (value && !/^-+$/.test(value)) cells.push(value);
      end += 1;
    }
    if (cells.length < 4 || cells.length % 2) continue;
    const rows = [];
    for (let index = 0; index < cells.length; index += 2) rows.push(`| ${cells[index]} | ${cells[index + 1]} |`);
    rows.splice(1, 0, '| --- | --- |');
    lines.splice(start, end - start, ...rows);
    repairs.push({ level: 'warning', code: 'flattened-table-repaired', message: '클립보드에서 1열로 펴쳐진 표를 2열 구조로 복구했습니다.' });
    start += rows.length - 1;
  }
}

function makeBlock(kind: DocumentBlock['kind'], text: string, markdown?: string): DocumentBlock {
  return { id: crypto.randomUUID(), order: 0, kind, text, markdown };
}

function imageMarkdown(image: HTMLImageElement): string {
  const src = safeImageUrl(image.getAttribute('src') || '');
  if (!src) return escapeInline(image.alt || '');
  return `![${escapeInline(image.alt || '이미지')}](${src})`;
}

function safeUrl(value: string): string {
  const decoded = value.trim();
  return /^(https?:|mailto:)/i.test(decoded) ? decoded.replace(/[() ]/g, (char) => encodeURIComponent(char)) : '';
}

function safeImageUrl(value: string): string {
  return /^(https?:|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(value.trim()) ? value.trim() : '';
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u00a0\u200b\ufeff]/g, ' ').replace(/[ \t]+/g, ' ');
}

function escapeInline(value: string): string { return value.replace(/([\\`*_[\]])/g, '\\$1'); }
function escapeParagraph(value: string): string { return value.replace(/([\\`*_[\]<>])/g, '\\$1'); }
function looksLikeTableRow(value: string): boolean { return /^\s*\|?.+\|.+\|?\s*$/.test(value); }
function isTableSeparator(value: string): boolean { return /^\s*\|?\s*:?-{3,}/.test(value); }

function detectSource(html: string): WebDocument['source'] {
  if (/chatgpt|openai|data-message-author-role/i.test(html)) return 'chatgpt-answer';
  if (/gemini|bard|model-response/i.test(html)) return 'gemini-answer';
  return 'web-selection';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}
