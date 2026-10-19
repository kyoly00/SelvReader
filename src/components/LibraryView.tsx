import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { dbDeleteDocument, dbGet, dbGetAll, dbPut, type PdfMeta } from '../utils/db';
import { createPdfId, downloadPdf, looksLikePdf, pdfNameFromUrl } from '../utils/pdf';
import { deleteWebDocument, isExtension, listWebDocuments, saveWebDocument, type WebDocument } from '../utils/extension';
import { documentFromClipboard } from '../utils/clipboard';
import './LibraryView.css';

export function LibraryView() {
  const { setCurrentPdf, setViewMode, setSettingsOpen } = useAppStore();
  const [library, setLibrary] = useState<PdfMeta[]>([]);
  const [webDocuments, setWebDocuments] = useState<WebDocument[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pasteLoading, setPasteLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshLibrary = useCallback(async () => {
    const items = await dbGetAll<PdfMeta>('library');
    setLibrary(items.sort((a, b) => b.lastOpened - a.lastOpened));
  }, []);

  useEffect(() => {
    let active = true;
    void dbGetAll<PdfMeta>('library').then((items) => {
      if (active) setLibrary(items.sort((a, b) => b.lastOpened - a.lastOpened));
    });
    if (isExtension()) {
      void listWebDocuments().then((items) => { if (active) setWebDocuments(items); });
    }
    return () => { active = false; };
  }, []);

  const storeAndOpen = useCallback(async (buffer: ArrayBuffer, name: string, sourceUrl?: string) => {
    if (!looksLikePdf(buffer)) throw new Error('유효한 PDF 파일이 아닙니다.');
    const id = await createPdfId(buffer);
    const existing = await dbGet<PdfMeta>('library', id);
    const now = Date.now();
    const meta: PdfMeta = {
      id,
      name,
      sourceUrl: sourceUrl || existing?.sourceUrl,
      addedAt: existing?.addedAt || now,
      lastOpened: now,
      size: buffer.byteLength,
      title: existing?.title,
      totalPages: existing?.totalPages,
    };
    await dbPut('library', meta);
    await dbPut('pdfFiles', { id, data: buffer });
    setCurrentPdf({ id, name, data: buffer, url: sourceUrl });
    setViewMode('reader');
  }, [setCurrentPdf, setViewMode]);

  const openPdfFile = useCallback(async (file: File) => {
    setError('');
    try {
      await storeAndOpen(await file.arrayBuffer(), file.name);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [storeAndOpen]);

  const handleUrlLoad = useCallback(async () => {
    const value = urlInput.trim();
    if (!value) return;
    setLoading(true);
    setError('');
    try {
      const parsed = new URL(value);
      const buffer = await downloadPdf(parsed.href);
      await storeAndOpen(buffer, pdfNameFromUrl(parsed.href), parsed.href);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [storeAndOpen, urlInput]);

  const openFromLibrary = useCallback(async (item: PdfMeta) => {
    const stored = await dbGet<{ id: string; data: ArrayBuffer }>('pdfFiles', item.id);
    if (!stored) {
      setError('저장된 PDF 데이터를 찾지 못했습니다.');
      return;
    }
    await dbPut('library', { ...item, lastOpened: Date.now() });
    setCurrentPdf({ id: item.id, name: item.name, data: stored.data, url: item.sourceUrl });
    setViewMode('reader');
  }, [setCurrentPdf, setViewMode]);

  const deleteDocument = useCallback(async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (!confirm('이 문서와 하이라이트, 메모, 대화를 삭제할까요?')) return;
    await dbDeleteDocument(id);
    await refreshLibrary();
  }, [refreshLibrary]);

  const openWebDocument = useCallback((document: WebDocument) => {
    useAppStore.getState().setCurrentWebDocument(document);
    setViewMode('web');
    history.replaceState(null, '', `${location.pathname}?webdoc=${encodeURIComponent(document.id)}`);
  }, [setViewMode]);

  const removeWebDocument = useCallback(async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (!confirm('가져온 답변과 연결된 메모·대화를 삭제할까요?')) return;
    await deleteWebDocument(id);
    await dbDeleteDocument(id);
    setWebDocuments((items) => items.filter((item) => item.id !== id));
  }, []);

  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    setPasteLoading(true);
    setError('');
    try {
      const parsed = await documentFromClipboard(event.clipboardData);
      const stored = isExtension() ? await saveWebDocument(parsed) : parsed;
      setWebDocuments((items) => [stored, ...items.filter((item) => item.id !== stored.id)]);
      openWebDocument(stored);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPasteLoading(false);
      event.currentTarget.value = '';
    }
  }, [openWebDocument]);

  return (
    <div className="library-view">
      <div className="library-header">
        <h1 className="library-title">
          <span className="gradient-text">SelvReader</span>
          <span className="library-subtitle">READ · QUESTION · REMEMBER</span>
        </h1>
        <button className="btn library-settings" onClick={() => setSettingsOpen(true)}>API 설정</button>
      </div>

      <div className="library-content">
        <div
          className={`upload-area ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files[0];
            if (file) void openPdfFile(file);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openPdfFile(file);
          }} hidden />
          <div className="upload-icon">PDF</div>
          <p className="upload-text">PDF를 끌어놓거나 클릭해 여세요.</p>
          <p className="upload-hint">웹 PDF는 아래에 주소를 붙여넣을 수도 있습니다.</p>
        </div>

        <div className="url-input-group">
          <input type="url" className="url-input" placeholder="https://arxiv.org/pdf/..." value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void handleUrlLoad(); }} />
          <button className="btn btn-accent" onClick={() => void handleUrlLoad()} disabled={loading || !urlInput.trim()}>
            {loading ? <span className="spinner" /> : '열기'}
          </button>
        </div>
        <div className="clipboard-import">
          <label htmlFor="clipboard-import-input">AI 답변 붙여넣기</label>
          <textarea id="clipboard-import-input" value="" onChange={() => undefined} onPaste={(event) => void handlePaste(event)}
            disabled={pasteLoading} aria-describedby="clipboard-import-hint"
            placeholder={pasteLoading ? '붙여넣은 내용을 분석하는 중…' : 'ChatGPT·Gemini에서 복사한 답변을 여기에 붙여넣으세요.'} />
          <small id="clipboard-import-hint">HTML, Markdown, 표, 코드, 수식, Mermaid, 링크와 이미지를 함께 분석합니다.</small>
        </div>
        {error && <div className="library-error">{error}</div>}

        {library.length > 0 && (
          <section className="library-section">
            <h2 className="section-title">최근 문서</h2>
            <div className="library-grid">
              {library.map((item) => (
                <button key={item.id} className="library-card" onClick={() => void openFromLibrary(item)}>
                  <div className="card-icon">▤</div>
                  <div className="card-info">
                    <span className="card-name">{item.title || item.name}</span>
                    <span className="card-meta">{formatSize(item.size)} · {formatDate(item.lastOpened)}</span>
                  </div>
                  <span className="card-delete" role="button" tabIndex={0} onClick={(event) => void deleteDocument(event, item.id)}>삭제</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {webDocuments.length > 0 && (
          <section className="library-section">
            <h2 className="section-title">가져온 AI 답변</h2>
            <div className="library-grid">
              {webDocuments.map((document) => (
                <button key={document.id} className="library-card" onClick={() => openWebDocument(document)}>
                  <div className="card-icon">AI</div>
                  <div className="card-info">
                    <span className="card-name">{document.title}</span>
                    <span className="card-meta">{document.source === 'gemini-answer' ? 'Gemini' : document.source === 'chatgpt-answer' ? 'ChatGPT' : '웹 문서'} · {formatDate(document.updatedAt)}</span>
                  </div>
                  <span className="card-delete" role="button" tabIndex={0} onClick={(event) => void removeWebDocument(event, document.id)}>삭제</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}
