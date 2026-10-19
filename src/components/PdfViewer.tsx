import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useAppStore } from '../stores/appStore';
import type { AnnotationRecord, HighlightRecord, NormalizedRect } from '../utils/db';
import './PdfViewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface OutlineItem {
  title: string;
  dest: unknown;
  items: OutlineItem[];
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

export interface PdfTextSelection {
  text: string;
  rect: DOMRect;
  page: number;
  rects: NormalizedRect[];
  anchorElement: HTMLElement;
  anchorX: number;
  anchorY: number;
}

export interface PdfRegionSelection {
  imageDataUrl: string;
  rect: DOMRect;
  page: number;
}

interface RegionDrag {
  page: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface PageInfo {
  pageNum: number;
  width: number;
  height: number;
}

export function PdfViewer({
  highlights,
  notes,
  onOutlineReady,
  onTextSelect,
  regionSelectMode = false,
  onRegionSelect,
  fitWidthRequest = 0,
  pageNavigationRequest = null,
}: {
  highlights: HighlightRecord[];
  notes: AnnotationRecord[];
  onOutlineReady?: (outline: OutlineItem[]) => void;
  onTextSelect?: (selection: PdfTextSelection) => void;
  regionSelectMode?: boolean;
  onRegionSelect?: (selection: PdfRegionSelection) => void;
  fitWidthRequest?: number;
  pageNavigationRequest?: { page: number; id: number } | null;
}) {
  const {
    currentPdf,
    zoom,
    setTotalPages,
    setCurrentPage,
    setPageText,
    clearPageTexts,
    setPdfMetadata,
    currentPage,
    setZoom,
    zoomIn,
    zoomOut,
    zoomReset,
  } = useAppStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const renderingRef = useRef<Set<number>>(new Set());
  const renderedZoomRef = useRef<Map<number, number>>(new Map());
  const regionDragRef = useRef<RegionDrag | null>(null);
  const previousZoomRef = useRef(zoom);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const restoredPdfRef = useRef('');
  const restorePageRef = useRef<number | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState('');
  const [regionDrag, setRegionDrag] = useState<RegionDrag | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const fallbackUrl = useMemo(() => currentPdf
    ? URL.createObjectURL(new Blob([currentPdf.data], { type: 'application/pdf' }))
    : '', [currentPdf]);

  useEffect(() => {
    return () => { if (fallbackUrl) URL.revokeObjectURL(fallbackUrl); };
  }, [fallbackUrl]);

  useEffect(() => {
    if (!openNoteId) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.page-note-anchor')) return;
      setOpenNoteId(null);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [openNoteId]);

  useEffect(() => {
    if (!currentPdf) return;
    restoredPdfRef.current = '';
    restorePageRef.current = null;
    try {
      const saved = JSON.parse(localStorage.getItem(`selvreader-reading-${currentPdf.id}`) || 'null') as {
        page?: number;
        zoom?: number;
      } | null;
      if (saved?.page) {
        restorePageRef.current = saved.page;
        setCurrentPage(saved.page);
      }
      if (saved?.zoom) setZoom(saved.zoom);
    } catch {
      // Ignore an invalid local reading-position record.
    }
    const timer = window.setTimeout(() => { restoredPdfRef.current = currentPdf.id; }, 0);
    return () => window.clearTimeout(timer);
  }, [currentPdf, setCurrentPage, setZoom]);

  useEffect(() => {
    if (!currentPdf || restoredPdfRef.current !== currentPdf.id) return;
    localStorage.setItem(`selvreader-reading-${currentPdf.id}`, JSON.stringify({ page: currentPage, zoom }));
  }, [currentPage, currentPdf, zoom]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const previousZoom = previousZoomRef.current;
    previousZoomRef.current = zoom;
    if (!container || previousZoom === zoom) return;
    const ratio = zoom / previousZoom;
    const anchor = zoomAnchorRef.current || { x: container.clientWidth / 2, y: container.clientHeight / 2 };
    container.scrollLeft = (container.scrollLeft + anchor.x) * ratio - anchor.x;
    container.scrollTop = (container.scrollTop + anchor.y) * ratio - anchor.y;
    zoomAnchorRef.current = null;
  }, [zoom]);

  useEffect(() => {
    if (!currentPdf) return;
    const renderedZoom = renderedZoomRef.current;
    const rendering = renderingRef.current;
    clearPageTexts();
    let active = true;
    const loadTask = pdfjsLib.getDocument({ data: currentPdf.data.slice(0), isEvalSupported: false });

    void loadTask.promise.then(async (pdf) => {
      pdfDocRef.current = pdf;
      setTotalPages(pdf.numPages);
      const firstPage = await pdf.getPage(1);
      const baseViewport = firstPage.getViewport({ scale: 1 });
      setPages(Array.from({ length: pdf.numPages }, (_, index) => ({
        pageNum: index + 1,
        width: baseViewport.width,
        height: baseViewport.height,
      })));

      const outline = await pdf.getOutline().catch(() => null);
      onOutlineReady?.((outline || []) as unknown as OutlineItem[]);

      try {
        const metadata = await pdf.getMetadata();
        const info = metadata.info as Record<string, string>;
        const textContent = await firstPage.getTextContent();
        const firstPageText = textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
        setPageText(1, firstPageText);
        const abstractMatch = firstPageText.match(/abstract[:\s]*(.{50,1000}?)(?=introduction|\b1\.|keywords)/i);
        setPdfMetadata({
          title: info?.Title || currentPdf.name.replace(/\.pdf$/i, ''),
          abstract: abstractMatch?.[1]?.trim() || firstPageText.slice(0, 500),
        });
      } catch {
        setPdfMetadata({ title: currentPdf.name, abstract: '' });
      }
      setLoading(false);

      // 문맥 검색은 화면에 렌더된 페이지만이 아니라 문서 전체 텍스트를 대상으로 한다.
      void extractPageTexts(pdf, (page, text) => {
        if (active) setPageText(page, text);
      });
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'PDF를 불러오지 못했습니다.');
      setLoading(false);
    });

    return () => {
      active = false;
      observerRef.current?.disconnect();
      renderedZoom.clear();
      rendering.clear();
      pdfDocRef.current = null;
      void loadTask.destroy();
    };
  }, [clearPageTexts, currentPdf, onOutlineReady, setPageText, setPdfMetadata, setTotalPages]);

  const renderPage = useCallback(async (pageNum: number) => {
    const pdf = pdfDocRef.current;
    const canvas = canvasRefs.current.get(pageNum);
    if (!pdf || !canvas || renderingRef.current.has(pageNum)) return;
    if (renderedZoomRef.current.get(pageNum) === zoom) return;
    renderingRef.current.add(pageNum);

    try {
      const page = await pdf.getPage(pageNum);
      const outputViewport = page.getViewport({ scale: zoom * window.devicePixelRatio });
      const displayViewport = page.getViewport({ scale: zoom });
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = Math.ceil(outputViewport.width);
      canvas.height = Math.ceil(outputViewport.height);
      canvas.style.width = `${displayViewport.width}px`;
      canvas.style.height = `${displayViewport.height}px`;
      const wrapper = canvas.parentElement;
      if (wrapper) {
        wrapper.style.width = `${displayViewport.width}px`;
        wrapper.style.height = `${displayViewport.height}px`;
        wrapper.style.setProperty('--total-scale-factor', String(zoom));
        wrapper.style.setProperty('--scale-round-x', '1px');
        wrapper.style.setProperty('--scale-round-y', '1px');
      }

      await page.render({ canvas, canvasContext: context, viewport: outputViewport }).promise;
      const textLayerElement = wrapper?.querySelector('.textLayer') as HTMLDivElement | null;
      if (textLayerElement) {
        textLayerElement.replaceChildren();
        textLayerElement.style.width = `${displayViewport.width}px`;
        textLayerElement.style.height = `${displayViewport.height}px`;
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        if (pageText.trim() && isCanvasBlank(canvas)) {
          throw new Error('PDF.js가 빈 화면을 렌더링했습니다. 원본 뷰어로 전환합니다.');
        }
        setPageText(pageNum, pageText);
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerElement,
          viewport: displayViewport,
        });
        await textLayer.render();
      }
      renderedZoomRef.current.set(pageNum, zoom);
    } catch (reason) {
      console.error(`페이지 ${pageNum} 렌더링 실패`, reason);
      const message = reason instanceof Error ? reason.message : '페이지 렌더링에 실패했습니다.';
      if (!/RenderingCancelledException/i.test(message)) setRenderError(message);
    } finally {
      renderingRef.current.delete(pageNum);
    }
  }, [setPageText, zoom]);

  useEffect(() => {
    if (pages.length === 0) return;
    const frame = requestAnimationFrame(() => {
      void renderPage(Math.min(Math.max(currentPage, 1), pages.length));
      if (currentPage < pages.length) void renderPage(currentPage + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [currentPage, pages, renderPage]);

  useEffect(() => {
    if (pages.length === 0) return;
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const page = Number(entry.target.getAttribute('data-page'));
        if (page > 0) void renderPage(page);
      }
    }, { root: containerRef.current, rootMargin: '300px' });
    containerRef.current?.querySelectorAll('.page-wrapper').forEach((element) => {
      observerRef.current?.observe(element);
    });
    return () => observerRef.current?.disconnect();
  }, [pages, renderPage]);

  const scrollToPage = useCallback((page: number, behavior: ScrollBehavior = 'smooth') => {
    const container = containerRef.current;
    const target = container?.querySelector(`[data-page="${page}"]`) as HTMLElement | null;
    if (!container || !target) return;
    setCurrentPage(page);
    const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
    container.scrollTo({ top, behavior });
  }, [setCurrentPage]);

  useEffect(() => {
    const page = restorePageRef.current;
    if (!page || pages.length === 0) return;
    restorePageRef.current = null;
    scrollToPage(Math.min(page, pages.length), 'auto');
  }, [pages.length, scrollToPage]);

  useEffect(() => {
    if (!pageNavigationRequest) return;
    scrollToPage(pageNavigationRequest.page);
  }, [pageNavigationRequest, scrollToPage]);

  const navigateToDestination = useCallback(async (destination: unknown) => {
    const pdf = pdfDocRef.current;
    if (!pdf) return;
    try {
      const resolved = typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
      if (!Array.isArray(resolved)) return;
      const pageIndex = await pdf.getPageIndex(resolved[0]);
      scrollToPage(pageIndex + 1);
    } catch (reason) {
      console.error('PDF 목차 이동 실패', reason);
    }
  }, [scrollToPage]);

  useEffect(() => {
    const target = window as unknown as { __selvreaderPdfNavigate?: (dest: unknown) => void };
    target.__selvreaderPdfNavigate = navigateToDestination;
    return () => { delete target.__selvreaderPdfNavigate; };
  }, [navigateToDestination]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleMouseUp = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.page-note-anchor')) return;
      const selection = window.getSelection();
      if (!selection?.toString().trim() || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const rectList = [...range.getClientRects()].filter((item) => item.width > 0 && item.height > 0);
      const rect = selectionEndpointRect(rectList, event);
      const firstRect = rectList[0];
      const pageElement = firstRect
        ? document.elementFromPoint(firstRect.left + 1, firstRect.top + 1)?.closest('.page-wrapper') as HTMLElement | null
        : null;
      if (!pageElement) return;
      const pageRect = pageElement.getBoundingClientRect();
      const page = Number(pageElement.dataset.page);
      const normalized = rectList
        .filter((item) => item.bottom >= pageRect.top && item.top <= pageRect.bottom)
        .map((item) => ({
          x: (item.left - pageRect.left) / pageRect.width,
          y: (item.top - pageRect.top) / pageRect.height,
          width: item.width / pageRect.width,
          height: item.height / pageRect.height,
        }));
      onTextSelect?.({
        text: selection.toString().trim(), rect, page, rects: normalized,
        anchorElement: pageElement,
        anchorX: (rect.left - pageRect.left) / pageRect.width,
        anchorY: (rect.bottom - pageRect.top) / pageRect.height,
      });
    };
    container.addEventListener('mouseup', handleMouseUp);
    return () => container.removeEventListener('mouseup', handleMouseUp);
  }, [onTextSelect]);

  const fitToWidth = useCallback(() => {
    const container = containerRef.current;
    const firstPage = pages[0];
    if (!container || !firstPage) return;
    const horizontalPadding = 32;
    setZoom((container.clientWidth - horizontalPadding) / firstPage.width);
  }, [pages, setZoom]);

  useEffect(() => {
    if (fitWidthRequest > 0) fitToWidth();
  }, [fitToWidth, fitWidthRequest]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      zoomAnchorRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const { zoomIn, zoomOut } = useAppStore.getState();
      if (event.deltaY < 0) zoomIn();
      else zoomOut();
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === 'j') {
        event.preventDefault();
        scrollToPage(Math.min(pages.length || 1, currentPage + 1));
      } else if (key === 'k') {
        event.preventDefault();
        scrollToPage(Math.max(1, currentPage - 1));
      } else if (key === 'w') {
        event.preventDefault();
        fitToWidth();
      } else if (key === '0') {
        event.preventDefault();
        zoomReset();
      } else if (key === '=' || key === '+') {
        event.preventDefault();
        zoomIn();
      } else if (key === '-') {
        event.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [currentPage, fitToWidth, pages.length, scrollToPage, zoomIn, zoomOut, zoomReset]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const midpoint = container.getBoundingClientRect().top + container.clientHeight * 0.35;
    let closestPage = 1;
    let closestDistance = Number.POSITIVE_INFINITY;
    container.querySelectorAll('.page-wrapper').forEach((element, index) => {
      const distance = Math.abs(element.getBoundingClientRect().top - midpoint);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = index + 1;
      }
    });
    setCurrentPage(closestPage);
  }, [setCurrentPage]);

  const handleRegionPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const startsOnText = Boolean(target?.closest('.textLayer span[role="presentation"]'));
    if (!regionSelectMode && !event.shiftKey && startsOnText) return;
    const pageElement = (event.target as Element).closest<HTMLElement>('.page-wrapper');
    if (!pageElement) return;
    event.preventDefault();
    const rect = pageElement.getBoundingClientRect();
    const drag: RegionDrag = {
      page: Number(pageElement.dataset.page),
      startX: clamp(event.clientX - rect.left, 0, rect.width),
      startY: clamp(event.clientY - rect.top, 0, rect.height),
      currentX: clamp(event.clientX - rect.left, 0, rect.width),
      currentY: clamp(event.clientY - rect.top, 0, rect.height),
    };
    regionDragRef.current = drag;
    setRegionDrag(drag);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [regionSelectMode]);

  const handleRegionPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = regionDragRef.current;
    if (!drag) return;
    const pageElement = containerRef.current?.querySelector<HTMLElement>(`[data-page="${drag.page}"]`);
    if (!pageElement) return;
    const rect = pageElement.getBoundingClientRect();
    const next = {
      ...drag,
      currentX: clamp(event.clientX - rect.left, 0, rect.width),
      currentY: clamp(event.clientY - rect.top, 0, rect.height),
    };
    regionDragRef.current = next;
    setRegionDrag(next);
  }, []);

  const handleRegionPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = regionDragRef.current;
    regionDragRef.current = null;
    setRegionDrag(null);
    if (!drag) return;
    const pageElement = containerRef.current?.querySelector<HTMLElement>(`[data-page="${drag.page}"]`);
    const canvas = canvasRefs.current.get(drag.page);
    if (!pageElement || !canvas) return;
    const pageRect = pageElement.getBoundingClientRect();
    const x = Math.min(drag.startX, drag.currentX);
    const y = Math.min(drag.startY, drag.currentY);
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    if (width < 12 || height < 12) return;

    const sx = x / pageRect.width * canvas.width;
    const sy = y / pageRect.height * canvas.height;
    const sw = width / pageRect.width * canvas.width;
    const sh = height / pageRect.height * canvas.height;
    const output = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(sw, sh));
    output.width = Math.max(1, Math.round(sw * scale));
    output.height = Math.max(1, Math.round(sh * scale));
    output.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, output.width, output.height);
    onRegionSelect?.({
      imageDataUrl: output.toDataURL('image/jpeg', 0.9),
      rect: new DOMRect(pageRect.left + x, pageRect.top + y, width, height),
      page: drag.page,
    });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [onRegionSelect]);

  if (loading) return <div className="pdf-loading"><span className="spinner" />PDF 불러오는 중…</div>;
  if (error) return <div className="pdf-loading"><strong>PDF를 열 수 없습니다.</strong><span>{error}</span></div>;
  return (
    <div className={`pdf-viewer-container ${regionSelectMode ? 'region-select-mode' : ''}`}
      ref={containerRef} onScroll={handleScroll} id="pdf-viewer"
      onPointerDown={handleRegionPointerDown} onPointerMove={handleRegionPointerMove} onPointerUp={handleRegionPointerUp}>
      {renderError && <div className="pdf-render-warning">
        일부 PDF 레이어를 렌더링하지 못했습니다. <span>{renderError}</span>
        {fallbackUrl && <a href={fallbackUrl} target="_blank" rel="noreferrer">Chrome 원본 뷰어 열기</a>}
      </div>}
      <div className="pdf-pages">
        {pages.map((page) => (
          <div
            key={page.pageNum}
            className="page-wrapper"
            data-page={page.pageNum}
            style={{ width: page.width * zoom, height: page.height * zoom }}
          >
            <canvas ref={(element) => {
              if (element) canvasRefs.current.set(page.pageNum, element);
              else canvasRefs.current.delete(page.pageNum);
            }} className="page-canvas" />
            <div className="textLayer" />
            <div className="highlight-layer" aria-hidden="true">
              {highlights.filter((highlight) => highlight.page === page.pageNum).flatMap((highlight) => (
                (highlight.rects || []).map((rect, index) => (
                  <span
                    key={`${highlight.id}-${index}`}
                    className={`saved-highlight ${highlight.color}`}
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                    }}
                  />
                ))
              ))}
            </div>
            {notes.filter((note) => note.page === page.pageNum).map((note, index) => {
              const top = note.rects?.[0] ? `${Math.min(88, Math.max(2, note.rects[0].y * 100))}%` : `${18 + index * 34}px`;
              return (
                <div className="page-note-anchor" style={{ top }} key={note.id}
                  onPointerDown={(event) => event.stopPropagation()}>
                  <button type="button" className="note-marker" title="메모 보기"
                    aria-label="메모 보기" onClick={() => setOpenNoteId((current) => current === note.id ? null : note.id)}>
                    <NoteBubbleIcon />
                  </button>
                  {openNoteId === note.id && (
                    <div className="page-note-popover">
                      <div className="page-note-title">메모</div>
                      <div className="page-note-quote">{note.quote}</div>
                      <div className="page-note-body">{note.body}</div>
                    </div>
                  )}
                </div>
              );
            })}
            {regionDrag?.page === page.pageNum && (
              <div className="region-selection-box" style={regionStyle(regionDrag)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NoteBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.2L7 20v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
      <path d="M7 9h10M7 12.5h7" />
    </svg>
  );
}

function regionStyle(drag: RegionDrag) {
  return {
    left: Math.min(drag.startX, drag.currentX),
    top: Math.min(drag.startY, drag.currentY),
    width: Math.abs(drag.currentX - drag.startX),
    height: Math.abs(drag.currentY - drag.startY),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function extractPageTexts(
  pdf: pdfjsLib.PDFDocumentProxy,
  save: (page: number, text: string) => void,
) {
  let nextPage = 1;
  const worker = async () => {
    while (nextPage <= pdf.numPages) {
      const pageNumber = nextPage++;
      try {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        save(pageNumber, text);
      } catch {
        // 암호화되었거나 텍스트가 없는 페이지만 건너뛴다. 화면 렌더링은 계속 시도한다.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pdf.numPages) }, worker));
}

function isCanvasBlank(canvas: HTMLCanvasElement) {
  if (canvas.width === 0 || canvas.height === 0) return true;
  const probe = document.createElement('canvas');
  probe.width = Math.min(180, canvas.width);
  probe.height = Math.min(180, canvas.height);
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(canvas, 0, 0, probe.width, probe.height);
  const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
  let nonWhite = 0;
  for (let y = 0; y < probe.height; y += 1) {
    for (let x = 0; x < probe.width; x += 1) {
      const index = (y * probe.width + x) * 4;
      const alpha = pixels[index + 3];
      if (alpha > 0 && (pixels[index] < 248 || pixels[index + 1] < 248 || pixels[index + 2] < 248)) {
        nonWhite += 1;
        if (nonWhite >= 8) return false;
      }
    }
  }
  return true;
}
