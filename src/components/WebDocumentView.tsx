import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFootnotes from 'remark-footnotes';
import rehypeKatex from 'rehype-katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import type { DocumentCitation, WebDocument } from '../utils/extension';
import type { AnnotationRecord, HighlightRecord } from '../utils/db';
import { CodeBlock } from './CodeBlock';
import { remarkCallouts } from '../utils/remarkCallouts';
import './WebDocumentView.css';

export function WebDocumentView({
  document,
  highlights,
  notes,
  onTextSelect,
}: {
  document: WebDocument;
  highlights: HighlightRecord[];
  notes: AnnotationRecord[];
  onTextSelect: (selection: WebTextSelection) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openCitationId, setOpenCitationId] = useState<string | null>(null);

  useEffect(() => {
    if (!openNoteId && !openCitationId) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.web-note-anchor, .citation-wrap')) return;
      setOpenNoteId(null);
      setOpenCitationId(null);
    };
    window.document.addEventListener('mousedown', closeOnOutsideClick);
    return () => window.document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [openCitationId, openNoteId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpenNoteId(null); setOpenCitationId(null); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleSelection = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.web-note-anchor, .citation-wrap')) return;
      const selection = window.getSelection();
      if (!selection?.toString().trim() || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const selectionRects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement || node;
      const block = node instanceof Element ? node.closest<HTMLElement>('[data-block-id]') : null;
      if (!block) return;
      const anchorRect = selectionEndpointRect(selectionRects, event);
      const blockRect = block.getBoundingClientRect();
      const before = range.cloneRange();
      before.selectNodeContents(block);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      onTextSelect({
        text: selection.toString().trim(),
        rect: anchorRect,
        blockId: block.dataset.blockId || '',
        start,
        end: start + selection.toString().length,
        anchorElement: block,
        anchorX: blockRect.width > 0 ? (anchorRect.left - blockRect.left) / blockRect.width : 0,
        anchorY: blockRect.height > 0 ? (anchorRect.bottom - blockRect.top) / blockRect.height : 0,
      });
    };
    element.addEventListener('mouseup', handleSelection);
    return () => element.removeEventListener('mouseup', handleSelection);
  }, [onTextSelect]);

  useLayoutEffect(() => {
    const article = ref.current;
    if (!article) return;
    article.querySelectorAll('mark.web-highlight').forEach((mark) => mark.replaceWith(...mark.childNodes));
    article.normalize();
    for (const highlight of [...highlights].sort((a, b) => (b.start || 0) - (a.start || 0))) {
      if (!highlight.blockId || typeof highlight.start !== 'number' || typeof highlight.end !== 'number') continue;
      const block = [...article.querySelectorAll<HTMLElement>('[data-block-id]')]
        .find((element) => element.dataset.blockId === highlight.blockId);
      if (block) markTextRange(block, highlight.start, highlight.end, highlight.id, highlight.color);
    }
  }, [document, highlights]);

  return (
    <main className="web-document-scroll">
      <article className="web-document" data-selvreader-document="true" ref={ref}>
        <header>
          <span className="source-badge">{sourceLabel(document.source)}</span>
          <h1>{document.title}</h1>
          {document.sourceUrl && <a href={document.sourceUrl} target="_blank" rel="noreferrer">원본 대화 열기</a>}
        </header>
        {document.blocks.map((block) => {
          const blockNotes = notes.filter((note) => note.blockId === block.id ||
            (!note.blockId && Boolean(note.quote) && block.text.includes(note.quote)));
          return (
            <div className="web-block-shell" key={block.id}>
              <div className={`web-markdown-block kind-${block.kind}`} data-block-id={block.id}>
                {block.kind === 'html' && block.html ? <SanitizedRichHtml html={block.html} /> : <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath, remarkFootnotes as unknown as typeof remarkGfm, remarkCallouts]}
                  rehypePlugins={[rehypeKatex]}
                  urlTransform={(url) => url.startsWith('selvreader-citation:') || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url)
                    ? url : defaultUrlTransform(url)}
                  components={{
                    a: ({ children, href, ...props }) => {
                      if (href?.startsWith('selvreader-citation:')) {
                        const id = decodeURIComponent(href.slice('selvreader-citation:'.length));
                        const citation = document.citations?.find((item) => item.id === id);
                        if (citation) return <CitationButton citation={citation} open={openCitationId === id}
                          onToggle={() => setOpenCitationId((current) => current === id ? null : id)} />;
                      }
                      return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;
                    },
                    pre: ({ children, ...props }) => {
                      const child = Children.toArray(children)[0];
                      if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
                        const language = child.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] || 'text';
                        return <CodeBlock source={String(child.props.children || '').replace(/\n$/, '')} language={language} />;
                      }
                      return <pre {...props}>{children}</pre>;
                    },
                  }}
                >{block.markdown || legacyBlockMarkdown(block)}</ReactMarkdown>}
              </div>
              {blockNotes.map((note, index) => {
                const progress = typeof note.start === 'number' && block.text.length
                  ? Math.min(85, Math.max(5, note.start / block.text.length * 100))
                  : 10 + index * 24;
                return <div className="web-note-anchor" style={{ top: `${progress}%` }} key={note.id}>
                  <button type="button" className="note-marker" title="메모 보기" aria-label="메모 보기"
                    onClick={() => setOpenNoteId((current) => current === note.id ? null : note.id)}>
                    <NoteBubbleIcon />
                  </button>
                  {openNoteId === note.id && <div className="web-note-popover">
                    <div className="web-note-title">메모</div>
                    <div className="web-note-quote">{note.quote}</div>
                    <div className="web-note-body">{note.body}</div>
                  </div>}
                </div>;
              })}
            </div>
          );
        })}
        {document.citations && document.citations.length > 0 && <section className="citation-registry" aria-labelledby="citation-registry-title">
          <h2 id="citation-registry-title">참고 출처</h2>
          <ol>{document.citations.map((citation) => <li key={citation.id}>
            <a href={citation.url} target="_blank" rel="noreferrer">{citation.title || citation.hostname}</a>
            {(citation.hostname || citation.kind === 'footnote') && <small>{citation.kind === 'footnote' ? '각주 · ' : ''}{citation.hostname}</small>}
          </li>)}</ol>
        </section>}
        {document.diagnostics && document.diagnostics.length > 0 && <details className="render-diagnostics">
          <summary>가져오기 진단 {document.diagnostics.length}건</summary>
          <ul>{document.diagnostics.map((item, index) => <li className={item.level} key={`${item.code}-${index}`}>{item.message}</li>)}</ul>
        </details>}
      </article>
    </main>
  );
}

function selectionEndpointRect(rects: DOMRect[], event: MouseEvent): DOMRect {
  if (rects.length === 0) return new DOMRect(event.clientX, event.clientY, 0, 0);
  const distanceToRect = (rect: DOMRect) => {
    const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
    const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
    return dx * dx + dy * dy;
  };
  const endpointLine = rects.reduce((closest, rect) =>
    distanceToRect(rect) < distanceToRect(closest) ? rect : closest);
  const endpointX = Math.max(endpointLine.left, Math.min(event.clientX, endpointLine.right));
  return new DOMRect(endpointX, endpointLine.top, 0, endpointLine.height);
}

function SanitizedRichHtml({ html }: { html: string }) {
  const isSvg = /^\s*<svg[\s>]/i.test(html);
  const safeHtml = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: isSvg ? ['script', 'iframe', 'object', 'embed', 'foreignObject'] : ['script', 'style', 'iframe', 'object', 'embed', 'foreignObject'],
    FORBID_ATTR: ['srcdoc'],
  });
  // Small SVGs can use a data URL; large diagrams stay inline below to avoid
  // browser URL-size limits and broken-image placeholders.
  if (isSvg && safeHtml && safeHtml.length < 50000) {
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeHtml)}`;
    return <div className="rich-html-block" role="figure" aria-label="원본 SVG 다이어그램"><img src={dataUrl} alt="원본 다이어그램" /></div>;
  }
  return <div className="rich-html-block" role="figure" aria-label="원본 시각 콘텐츠"
    dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

function CitationButton({ citation, open, onToggle }: { citation: DocumentCitation; open: boolean; onToggle: () => void }) {
  return <span className="citation-wrap">
    <a href={citation.url} className="citation-button" aria-expanded={open}
      onClick={(event) => { event.preventDefault(); onToggle(); }}
      title={`${citation.hostname || citation.title} 출처 보기`}>{citation.label}</a>
    {open && <span className="citation-popover" role="dialog">
      <strong>{citation.title}</strong>
      {citation.snippet && citation.snippet !== citation.title && <span>{citation.snippet}</span>}
      <a href={citation.url} target="_blank" rel="noreferrer">{citation.hostname || '출처 열기'} ↗</a>
    </span>}
  </span>;
}

export interface WebTextSelection {
  text: string;
  rect: DOMRect;
  blockId: string;
  start: number;
  end: number;
  anchorElement: HTMLElement;
  anchorX: number;
  anchorY: number;
}

function NoteBubbleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.2L7 20v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
    <path d="M7 9h10M7 12.5h7" />
  </svg>;
}

function legacyBlockMarkdown(block: WebDocument['blocks'][number]) {
  const text = block.text.replace(/([\\`*_[\]<>])/g, '\\$1');
  if (block.kind === 'heading') return `## ${text}`;
  if (block.kind === 'quote') return text.split('\n').map((line) => `> ${line}`).join('\n');
  if (block.kind === 'code') return `\`\`\`${block.language || 'text'}\n${block.text}\n\`\`\``;
  if (block.kind === 'table') return `\`\`\`text\n${block.text}\n\`\`\``;
  return text;
}

function markTextRange(root: HTMLElement, start: number, end: number, id: string, color: string) {
  if (end <= start) return;
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const next = offset + node.data.length;
    if (next > start && offset < end) nodes.push({ node, start: offset, end: next });
    offset = next;
  }
  for (const entry of nodes.reverse()) {
    const localStart = Math.max(0, start - entry.start);
    const localEnd = Math.min(entry.node.data.length, end - entry.start);
    if (localEnd <= localStart) continue;
    const selected = entry.node.splitText(localStart);
    selected.splitText(localEnd - localStart);
    const mark = window.document.createElement('mark');
    mark.className = `web-highlight ${color}`;
    mark.dataset.highlightId = id;
    selected.replaceWith(mark);
    mark.append(selected);
  }
}

function sourceLabel(source: WebDocument['source']) {
  if (source === 'chatgpt-answer') return 'ChatGPT 답변';
  if (source === 'gemini-answer') return 'Gemini 답변';
  return '웹 문서';
}
