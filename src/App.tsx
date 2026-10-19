import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from './stores/appStore';
import { LibraryView } from './components/LibraryView';
import { Toolbar } from './components/Toolbar';
import { PdfViewer, type OutlineItem, type PdfRegionSelection, type PdfTextSelection } from './components/PdfViewer';
import { TocPanel } from './components/TocPanel';
import { QuickActionModal, type InlineTranslation } from './components/QuickActionModal';
import { SettingsModal } from './components/SettingsModal';
import { AIPanel } from './components/AIPanel';
import { WebDocumentView } from './components/WebDocumentView';
import type { WebTextSelection } from './components/WebDocumentView';
import {
  dbDelete,
  dbGetByDocument,
  dbPut,
  type AnnotationRecord,
  type ChatMessageRecord,
  type HighlightRecord,
} from './utils/db';
import { getWebDocument, requestAI, type AIAction, type WebDocument } from './utils/extension';
import { buildSmartContext } from './utils/context';
import { createPdfId, downloadPdf, pdfNameFromUrl } from './utils/pdf';
import './App.css';

interface ActiveSelection {
  id: string;
  x: number;
  y: number;
  text: string;
  page?: number;
  rects?: PdfTextSelection['rects'];
  blockId?: string;
  start?: number;
  end?: number;
  imageDataUrl?: string;
  anchorElement?: HTMLElement;
  anchorX?: number;
  anchorY?: number;
}

interface HighlightUndoEntry {
  operation: 'added' | 'removed';
  highlights: HighlightRecord[];
}

interface TranslationPopoverState extends InlineTranslation {
  selectionId: string;
}

function App() {
  const {
    viewMode,
    setViewMode,
    currentPdf,
    setCurrentPdf,
    currentWebDocument,
    setCurrentWebDocument,
    settingsOpen,
    selectedText,
    setSelectedText,
    currentPage,
    pageTexts,
    contextLevel,
    pdfMetadata,
  } = useAppStore();
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const [translationPopover, setTranslationPopover] = useState<TranslationPopoverState | null>(null);
  const [pendingSelections, setPendingSelections] = useState<ActiveSelection[]>([]);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [notes, setNotes] = useState<AnnotationRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => localStorage.getItem('selvreader-left-panel') !== 'closed');
  const [rightPanelOpen, setRightPanelOpen] = useState(() => localStorage.getItem('selvreader-right-panel') !== 'closed');
  const [regionSelectMode, setRegionSelectMode] = useState(false);
  const [questionFocusRequest, setQuestionFocusRequest] = useState(0);
  const [fitWidthRequest, setFitWidthRequest] = useState(0);
  const [pageNavigationRequest, setPageNavigationRequest] = useState<{ page: number; id: number } | null>(null);
  const [loadedDocumentId, setLoadedDocumentId] = useState('');
  const initializedRef = useRef(false);
  const highlightUndoRef = useRef<HighlightUndoEntry[]>([]);
  const initialActionRef = useRef<AIAction | null>(null);
  const initialComposeRef = useRef(false);
  const documentId = currentPdf?.id || currentWebDocument?.id || '';

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const params = new URLSearchParams(location.search);
    const pdfUrl = params.get('pdf');
    const webDocumentId = params.get('webdoc');
    const action = params.get('action');
    if (action === 'explain' || action === 'translate') initialActionRef.current = action;
    initialComposeRef.current = params.get('compose') === '1';

    if (pdfUrl) {
      void loadPdfFromUrl(pdfUrl, setCurrentPdf, setViewMode).catch((error: Error) => setAiError(error.message));
    } else if (webDocumentId) {
      void getWebDocument(webDocumentId).then((document) => {
        if (!document) throw new Error('가져온 웹 답변을 찾을 수 없습니다.');
        setCurrentWebDocument(document);
        const initialSelection = document.selectedText?.trim() || '';
        setSelectedText(initialSelection);
        setPendingSelections(initialSelection ? [{
          id: crypto.randomUUID(),
          x: 0,
          y: 0,
          text: initialSelection,
        }] : []);
        setViewMode('web');
      }).catch((error: Error) => setAiError(error.message));
    }
  }, [setCurrentPdf, setCurrentWebDocument, setSelectedText, setViewMode]);

  useEffect(() => {
    if (!documentId) return;
    highlightUndoRef.current = [];
    void Promise.all([
      dbGetByDocument<HighlightRecord>('highlights', documentId),
      dbGetByDocument<AnnotationRecord>('annotations', documentId),
      dbGetByDocument<ChatMessageRecord>('chatMessages', documentId),
    ]).then(([storedHighlights, storedNotes, storedMessages]) => {
      setHighlights(storedHighlights);
      setNotes(storedNotes.sort((a, b) => a.createdAt - b.createdAt));
      setMessages(storedMessages.sort((a, b) => a.createdAt - b.createdAt));
      setLoadedDocumentId(documentId);
    });
  }, [documentId]);

  const runAction = useCallback(async (action: AIAction, question = '') => {
    if (!documentId) return;
    const selectionDetails = pendingSelections.at(-1) || activeSelection;
    const selection = pendingSelections.length > 0
      ? pendingSelections.map((item, index) => `[선택 ${index + 1}] ${item.text}`).join('\n\n')
      : activeSelection?.text || selectedText;
    const imageDataUrls = pendingSelections
      .map((item) => item.imageDataUrl)
      .filter((value): value is string => Boolean(value));
    const context = buildSmartContext({
      action,
      selection,
      question,
      contextLevel,
      title: currentWebDocument?.title || pdfMetadata?.title,
      abstract: pdfMetadata?.abstract,
      currentPage,
      selectionPage: selectionDetails?.page,
      pageTexts,
      webBlocks: currentWebDocument?.blocks,
      selectionBlockId: selectionDetails?.blockId,
    });
    setAiLoading(true);
    setAiError('');
    setActiveSelection(null);
    setPendingSelections([]);
    setSelectedText('');
    window.getSelection()?.removeAllRanges();
    const userContent = action === 'translate' ? '선택문 번역' : action === 'explain' ? '선택문 설명' : question || '선택문을 분석해 주세요.';
    const userMessage: ChatMessageRecord = {
      id: crypto.randomUUID(), documentId, role: 'user', content: userContent,
      selection, imageDataUrl: imageDataUrls[0], imageDataUrls, createdAt: Date.now(),
    };
    setMessages((current) => [...current, userMessage]);
    await dbPut('chatMessages', userMessage);
    try {
      const result = await requestAI({
        action,
        selection,
        context,
        question,
        imageDataUrl: imageDataUrls[0],
        imageDataUrls,
        history: messages.slice(-8).map((message) => ({
          role: message.role,
          content: message.content,
          selection: message.selection,
        })),
        memory: notes.slice(-12).map((note) => `${note.quote ? `${note.quote}: ` : ''}${note.body}`).join('\n'),
      });
      const assistantMessage: ChatMessageRecord = {
        id: crypto.randomUUID(), documentId, role: 'assistant', content: result.text,
        model: result.model, provider: result.provider, inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens, createdAt: Date.now(),
      };
      setMessages((current) => [...current, assistantMessage]);
      await dbPut('chatMessages', assistantMessage);
    } catch (error) {
      setAiError((error as Error).message);
    } finally {
      setAiLoading(false);
    }
  }, [activeSelection, contextLevel, currentPage, currentWebDocument, documentId, messages, notes, pageTexts, pdfMetadata, pendingSelections, selectedText, setSelectedText]);

  const prepareQuestion = useCallback(() => {
    if (activeSelection) {
      setPendingSelections((current) => current.some((item) => item.id === activeSelection.id)
        ? current
        : [...current, activeSelection]);
      setSelectedText(activeSelection.text);
    }
    setActiveSelection(null);
    setRightPanelOpen(true);
    localStorage.setItem('selvreader-right-panel', 'open');
    setQuestionFocusRequest((value) => value + 1);
  }, [activeSelection, setSelectedText]);

  const translateSelection = useCallback(async (selectionOverride?: ActiveSelection) => {
    const selection = selectionOverride || activeSelection;
    if (!documentId || !selection || selection.imageDataUrl) return;
    setActiveSelection(selection);
    setTranslationPopover({ selectionId: selection.id, loading: true, text: '', error: '' });
    setPendingSelections((current) => current.filter((item) => item.id !== selection.id));
    setSelectedText('');
    const context = buildSmartContext({
      action: 'translate',
      selection: selection.text,
      question: '',
      contextLevel,
      title: currentWebDocument?.title || pdfMetadata?.title,
      abstract: pdfMetadata?.abstract,
      currentPage,
      selectionPage: selection.page,
      pageTexts,
      webBlocks: currentWebDocument?.blocks,
      selectionBlockId: selection.blockId,
    });
    try {
      const result = await requestAI({ action: 'translate', selection: selection.text, context });
      setTranslationPopover((current) => current?.selectionId === selection.id
        ? { selectionId: selection.id, loading: false, text: result.text, error: '' }
        : current);
    } catch (error) {
      setTranslationPopover((current) => current?.selectionId === selection.id
        ? { selectionId: selection.id, loading: false, text: '', error: (error as Error).message }
        : current);
    }
  }, [activeSelection, contextLevel, currentPage, currentWebDocument, documentId, pageTexts, pdfMetadata, setSelectedText]);

  useEffect(() => {
    if (!currentWebDocument || loadedDocumentId !== documentId || !initialActionRef.current) return;
    const action = initialActionRef.current;
    initialActionRef.current = null;
    if (action === 'translate') {
      const selection = pendingSelections.at(-1);
      if (selection) void translateSelection({ ...selection, x: window.innerWidth / 2, y: 80 });
      return;
    }
    void runAction(action);
  }, [currentWebDocument, documentId, loadedDocumentId, pendingSelections, runAction, translateSelection]);

  const removePendingSelection = useCallback((id: string) => {
    setPendingSelections((current) => current.filter((selection) => selection.id !== id));
    setActiveSelection((current) => current?.id === id ? null : current);
    setSelectedText('');
  }, [setSelectedText]);

  useEffect(() => {
    if (!currentWebDocument || !initialComposeRef.current) return;
    initialComposeRef.current = false;
    prepareQuestion();
  }, [currentWebDocument, prepareQuestion]);

  const selectText = useCallback((text: string, rect: DOMRect, selection?: PdfTextSelection | WebTextSelection) => {
    setTranslationPopover(null);
    const pdfSelection = selection && 'page' in selection ? selection : undefined;
    const webSelection = selection && 'blockId' in selection ? selection : undefined;
    const nextSelection: ActiveSelection = {
      id: crypto.randomUUID(),
      x: rect.x + rect.width / 2,
      y: rect.bottom,
      text,
      page: pdfSelection?.page,
      rects: pdfSelection?.rects,
      blockId: webSelection?.blockId,
      start: webSelection?.start,
      end: webSelection?.end,
      anchorElement: selection?.anchorElement,
      anchorX: selection?.anchorX,
      anchorY: selection?.anchorY,
    };
    setActiveSelection(nextSelection);
  }, []);

  const selectRegion = useCallback((selection: PdfRegionSelection) => {
    const nextSelection: ActiveSelection = {
      id: crypto.randomUUID(),
      x: selection.rect.x + selection.rect.width / 2,
      y: selection.rect.bottom,
      text: `${selection.page}페이지 이미지 영역`,
      page: selection.page,
      imageDataUrl: selection.imageDataUrl,
    };
    setSelectedText(nextSelection.text);
    setPendingSelections((current) => [...current, nextSelection]);
    setActiveSelection(null);
    setRegionSelectMode(false);
    prepareQuestion();
  }, [prepareQuestion, setSelectedText]);

  const addHighlight = useCallback(async () => {
    if (!documentId || !activeSelection) return;
    if (!activeSelection.page && !activeSelection.blockId) return;
    const existing = highlights.filter((highlight) => overlapsHighlight(highlight, activeSelection));
    if (existing.length > 0) {
      await Promise.all(existing.map((highlight) => dbDelete('highlights', highlight.id)));
      const ids = new Set(existing.map((highlight) => highlight.id));
      setHighlights((current) => current.filter((highlight) => !ids.has(highlight.id)));
      highlightUndoRef.current.push({ operation: 'removed', highlights: existing });
      setActiveSelection(null);
      setPendingSelections((current) => current.filter((selection) => selection.id !== activeSelection.id));
      setSelectedText('');
      window.getSelection()?.removeAllRanges();
      return;
    }
    const highlight: HighlightRecord = {
      id: crypto.randomUUID(), documentId, page: activeSelection.page,
      quote: activeSelection.text, color: 'yellow', rects: activeSelection.rects,
      blockId: activeSelection.blockId, start: activeSelection.start, end: activeSelection.end,
      createdAt: Date.now(),
    };
    await dbPut('highlights', highlight);
    setHighlights((current) => [...current, highlight]);
    highlightUndoRef.current.push({ operation: 'added', highlights: [highlight] });
    setActiveSelection(null);
    setPendingSelections((current) => current.filter((selection) => selection.id !== activeSelection.id));
    setSelectedText('');
    window.getSelection()?.removeAllRanges();
  }, [activeSelection, documentId, highlights, setSelectedText]);

  const undoHighlight = useCallback(async () => {
    const entry = highlightUndoRef.current.pop();
    if (!entry) return;
    if (entry.operation === 'added') {
      await Promise.all(entry.highlights.map((highlight) => dbDelete('highlights', highlight.id)));
      const ids = new Set(entry.highlights.map((highlight) => highlight.id));
      setHighlights((current) => current.filter((highlight) => !ids.has(highlight.id)));
    } else {
      await Promise.all(entry.highlights.map((highlight) => dbPut('highlights', highlight)));
      const ids = new Set(entry.highlights.map((highlight) => highlight.id));
      setHighlights((current) => [...current.filter((highlight) => !ids.has(highlight.id)), ...entry.highlights]);
    }
  }, []);

  const addNote = useCallback(async (body: string) => {
    if (!documentId || !activeSelection) return;
    if (!body.trim()) return;
    const now = Date.now();
    const note: AnnotationRecord = {
      id: crypto.randomUUID(), documentId, page: activeSelection.page,
      quote: activeSelection.text, body: body.trim(), rects: activeSelection.rects,
      blockId: activeSelection.blockId, start: activeSelection.start, end: activeSelection.end,
      createdAt: now, updatedAt: now,
    };
    await dbPut('annotations', note);
    setNotes((current) => [...current, note]);
    setActiveSelection(null);
    setPendingSelections((current) => current.filter((selection) => selection.id !== activeSelection.id));
    setSelectedText('');
  }, [activeSelection, documentId, setSelectedText]);

  const deleteNote = useCallback(async (id: string) => {
    await dbDelete('annotations', id);
    setNotes((current) => current.filter((note) => note.id !== id));
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        void undoHighlight();
        return;
      }
      if (!activeSelection) return;
      if (!activeSelection.imageDataUrl && event.key.toLowerCase() === 'h') void addHighlight();
      if (!activeSelection.imageDataUrl && event.key.toLowerCase() === 't') void translateSelection();
      if (event.key.toLowerCase() === 'q') prepareQuestion();
      if (event.key === 'Escape') setActiveSelection(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSelection, addHighlight, prepareQuestion, translateSelection, undoHighlight]);

  const exportMarkdown = useCallback(() => {
    if (!documentId) return;
    const title = currentPdf?.name || currentWebDocument?.title || 'SelvReader 문서';
    const source = currentPdf?.url || currentWebDocument?.sourceUrl;
    const sections = [`# ${title}`, source ? `\n원본: ${source}` : ''];
    if (currentWebDocument?.blocks.length) {
      sections.push('\n## 가져온 답변', ...currentWebDocument.blocks.map((block) =>
        `\n${(block.markdown || block.text.replace(/([\\`*_[\]{}()#+\-.!<>$])/g, '\\$1'))
          .replace(/\[([^\]]+)]\(selvreader-citation:([^)]+)\)/g, (_match, label: string, encodedId: string) => {
            const id = decodeURIComponent(encodedId);
            const citation = currentWebDocument.citations?.find((item) => item.id === id);
            return citation ? `[${label}](${citation.url})` : label;
          })}`));
    }
    if (notes.length) sections.push('\n## 메모', ...notes.map((note) =>
      `\n${note.quote.split('\n').map((line) => `> ${line}`).join('\n')}\n\n${note.body}`));
    if (highlights.length) sections.push('\n## 하이라이트', ...highlights.map((item) => `\n- ${item.page ? `p.${item.page}` : '웹 답변'}: ${item.quote}`));
    if (messages.length) sections.push('\n## AI 대화', ...messages.map((message) => `\n### ${message.role === 'user' ? '나' : message.model || 'AI'}\n\n${message.imageDataUrls?.length || message.imageDataUrl ? `*PDF 이미지 영역 ${(message.imageDataUrls?.length || 1)}개 첨부*\n\n` : ''}${message.selection ? `> ${message.selection}\n\n` : ''}${message.content}`));
    const blob = new Blob([sections.filter(Boolean).join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [currentPdf, currentWebDocument, documentId, highlights, messages, notes]);

  const copyWebDocument = useCallback(async () => {
    if (!currentWebDocument) return;
    const markdown = webDocumentMarkdown(currentWebDocument);
    const article = window.document.querySelector<HTMLElement>('.web-document');
    const clone = article?.cloneNode(true) as HTMLElement | undefined;
    clone?.querySelectorAll('.web-note-anchor,.citation-popover,.render-diagnostics,.code-block-toolbar').forEach((node) => node.remove());
    const html = clone?.outerHTML || `<article><h1>${escapeHtml(currentWebDocument.title)}</h1><pre>${escapeHtml(markdown)}</pre></article>`;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } catch {
      await navigator.clipboard.writeText(markdown);
    }
  }, [currentWebDocument]);

  const exportHtml = useCallback(() => {
    if (!currentWebDocument) return;
    const article = window.document.querySelector<HTMLElement>('.web-document');
    const clone = article?.cloneNode(true) as HTMLElement | undefined;
    clone?.querySelectorAll('.web-note-anchor,.citation-popover,.render-diagnostics,.code-block-toolbar').forEach((node) => node.remove());
    const body = clone?.outerHTML || `<pre>${escapeHtml(webDocumentMarkdown(currentWebDocument))}</pre>`;
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(currentWebDocument.title)}</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;font:16px/1.75 system-ui,sans-serif;color:#18181b}img,svg{max-width:100%;height:auto}pre{overflow:auto;padding:14px;background:#f4f4f5;border-radius:8px}code{font-family:ui-monospace,monospace}table{border-collapse:collapse}th,td{padding:7px 10px;border:1px solid #d4d4d8}blockquote,.callout{padding-left:14px;border-left:3px solid #8b5cf6}</style></head><body>${body}</body></html>`;
    downloadBlob(html, 'text/html;charset=utf-8', `${safeFileName(currentWebDocument.title)}.html`);
  }, [currentWebDocument]);

  const resizePanel = useCallback((side: 'left' | 'right', event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth;
    const move = (moveEvent: MouseEvent) => {
      const delta = side === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const width = Math.max(side === 'left' ? 180 : 280, Math.min(side === 'left' ? 480 : 620, startWidth + delta));
      if (side === 'left') setLeftPanelWidth(width); else setRightPanelWidth(width);
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }, [leftPanelWidth, rightPanelWidth]);

  const toggleLeftPanel = useCallback(() => {
    setLeftPanelOpen((open) => {
      localStorage.setItem('selvreader-left-panel', open ? 'closed' : 'open');
      return !open;
    });
  }, []);

  const toggleRightPanel = useCallback(() => {
    setRightPanelOpen((open) => {
      localStorage.setItem('selvreader-right-panel', open ? 'closed' : 'open');
      return !open;
    });
  }, []);

  return (
    <div className="app" id="selvreader-app">
      <Toolbar onExport={exportMarkdown} onCopy={() => void copyWebDocument()} onExportHtml={exportHtml} leftPanelOpen={leftPanelOpen} rightPanelOpen={rightPanelOpen}
        onToggleLeftPanel={toggleLeftPanel} onToggleRightPanel={toggleRightPanel}
        regionSelectMode={regionSelectMode} onToggleRegionSelect={() => setRegionSelectMode((enabled) => !enabled)}
        onFitWidth={() => setFitWidthRequest((value) => value + 1)}
        onPageNavigate={(page) => setPageNavigationRequest({ page, id: Date.now() })} />
      <div className={`app-content ${viewMode !== 'library' ? 'reader-layout' : ''}`}>
        {viewMode === 'library' ? <LibraryView /> : (
          <>
            {viewMode === 'reader' && leftPanelOpen && <>
              <aside className="panel panel-left glass" style={{ width: leftPanelWidth }}><TocPanel outline={outline} /></aside>
              <div className="panel-resizer" onMouseDown={(event) => resizePanel('left', event)} />
            </>}
            <main className="panel panel-center">
              {viewMode === 'reader' && currentPdf && (
                <PdfViewer key={currentPdf.id} highlights={highlights} notes={notes} onOutlineReady={setOutline}
                  onTextSelect={(selection) => selectText(selection.text, selection.rect, selection)}
                  regionSelectMode={regionSelectMode} onRegionSelect={selectRegion}
                  fitWidthRequest={fitWidthRequest} pageNavigationRequest={pageNavigationRequest} />
              )}
              {viewMode === 'web' && currentWebDocument && (
                <WebDocumentView document={currentWebDocument} highlights={highlights} notes={notes}
                  onTextSelect={(selection) => selectText(selection.text, selection.rect, selection)} />
              )}
            </main>
            {rightPanelOpen && <>
              <div className="panel-resizer" onMouseDown={(event) => resizePanel('right', event)} />
              <aside className="panel panel-right glass" style={{ width: rightPanelWidth }}>
                <AIPanel messages={messages} notes={notes} loading={aiLoading} error={aiError}
                  attachments={pendingSelections} onRemoveAttachment={removePendingSelection}
                  focusRequest={questionFocusRequest} onAsk={(question) => void runAction('ask', question)}
                  onDeleteNote={(id) => void deleteNote(id)} />
              </aside>
            </>}
          </>
        )}
      </div>

      {activeSelection && <QuickActionModal x={activeSelection.x} y={activeSelection.y}
        anchorElement={activeSelection.anchorElement} anchorX={activeSelection.anchorX} anchorY={activeSelection.anchorY}
        onExplain={() => void runAction('explain')} onHighlight={() => void addHighlight()}
        onTranslate={() => void translateSelection()} onAnnotate={addNote}
        onAiQuestion={prepareQuestion} onClose={() => { setActiveSelection(null); setTranslationPopover(null); }}
        isImage={Boolean(activeSelection.imageDataUrl)}
        translation={translationPopover?.selectionId === activeSelection.id ? translationPopover : undefined} />}
      {settingsOpen && <SettingsModal />}
    </div>
  );
}

async function loadPdfFromUrl(
  url: string,
  setCurrentPdf: ReturnType<typeof useAppStore.getState>['setCurrentPdf'],
  setViewMode: ReturnType<typeof useAppStore.getState>['setViewMode'],
) {
  const data = await downloadPdf(url);
  const id = await createPdfId(data);
  const name = pdfNameFromUrl(url);
  const now = Date.now();
  await dbPut('library', { id, name, sourceUrl: url, addedAt: now, lastOpened: now, size: data.byteLength });
  await dbPut('pdfFiles', { id, data });
  setCurrentPdf({ id, name, data, url });
  setViewMode('reader');
}

function overlapsHighlight(highlight: HighlightRecord, selection: ActiveSelection) {
  if (selection.blockId) {
    if (highlight.blockId !== selection.blockId) return false;
    const firstStart = highlight.start ?? 0;
    const firstEnd = highlight.end ?? firstStart;
    const secondStart = selection.start ?? 0;
    const secondEnd = selection.end ?? secondStart;
    return Math.min(firstEnd, secondEnd) > Math.max(firstStart, secondStart);
  }
  if (!selection.page || highlight.page !== selection.page) return false;
  if (!highlight.rects?.length || !selection.rects?.length) {
    return highlight.quote.replace(/\s+/g, ' ').trim() === selection.text.replace(/\s+/g, ' ').trim();
  }
  return rectangleOverlap(rectangleBounds(highlight.rects), rectangleBounds(selection.rects)) >= 0.6;
}

function rectangleBounds(rects: Array<{ x: number; y: number; width: number; height: number }>) {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { left, top, right, bottom };
}

function rectangleOverlap(
  first: { left: number; top: number; right: number; bottom: number },
  second: { left: number; top: number; right: number; bottom: number },
) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const intersection = width * height;
  const firstArea = (first.right - first.left) * (first.bottom - first.top);
  const secondArea = (second.right - second.left) * (second.bottom - second.top);
  return intersection / Math.max(Math.min(firstArea, secondArea), Number.EPSILON);
}

function webDocumentMarkdown(webDocument: WebDocument) {
  const resolveCitations = (value: string) => value.replace(
    /\[([^\]]+)]\(selvreader-citation:([^)]+)\)/g,
    (_match, label: string, encodedId: string) => {
      const citation = webDocument.citations?.find((item) => item.id === decodeURIComponent(encodedId));
      return citation ? `[${label}](${citation.url})` : label;
    },
  );
  const sections = [`# ${webDocument.title}`];
  if (webDocument.sourceUrl) sections.push(`원본: ${webDocument.sourceUrl}`);
  sections.push(...webDocument.blocks.map((block) => resolveCitations(block.markdown || block.text)));
  if (webDocument.citations?.length) {
    sections.push('## 참고 출처', ...webDocument.citations.map((citation, index) =>
      `${index + 1}. [${citation.title || citation.hostname}](${citation.url})`,
    ));
  }
  return sections.filter(Boolean).join('\n\n');
}

function downloadBlob(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string) { return value.replace(/[\\/:*?"<>|]/g, '_'); }
function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default App;
