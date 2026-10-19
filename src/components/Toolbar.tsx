import { useAppStore } from '../stores/appStore';
import './Toolbar.css';

interface ToolbarProps {
  onExport?: () => void;
  onCopy?: () => void;
  onExportHtml?: () => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  regionSelectMode: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onToggleRegionSelect: () => void;
  onFitWidth: () => void;
  onPageNavigate: (page: number) => void;
}

export function Toolbar({ onExport, onCopy, onExportHtml, leftPanelOpen, rightPanelOpen, regionSelectMode,
  onToggleLeftPanel, onToggleRightPanel, onToggleRegionSelect, onFitWidth, onPageNavigate }: ToolbarProps) {
  const { currentPdf, currentWebDocument, viewMode, setViewMode, currentPage, totalPages,
    zoom, zoomIn, zoomOut, zoomReset, theme, toggleTheme, setSettingsOpen, setCurrentPdf, setCurrentWebDocument } = useAppStore();
  const back = () => {
    setCurrentPdf(null); setCurrentWebDocument(null); setViewMode('library');
    history.replaceState(null, '', location.pathname);
  };
  return (
    <div className="toolbar glass">
      <div className="toolbar-left">
        {viewMode !== 'library' && <button className="btn-icon" onClick={back} title="라이브러리로">←</button>}
        <strong className="toolbar-brand">SelvReader</strong>
        {(currentPdf || currentWebDocument) && <span className="toolbar-filename">{currentPdf?.name || currentWebDocument?.title}</span>}
      </div>
      {viewMode === 'reader' && (
        <div className="toolbar-center">
          <button className={`btn toolbar-tool ${regionSelectMode ? 'active' : ''}`}
            onClick={onToggleRegionSelect} title="그림 영역을 드래그해 질문 (기본 모드에서는 Shift+드래그)">
            영역 질문
          </button>
          <button className="btn-icon" onClick={zoomOut} title="축소 (-)">−</button>
          <button className="zoom-label" onClick={zoomReset} title="100%로 초기화 (0)">{Math.round(zoom * 100)}%</button>
          <button className="btn-icon" onClick={zoomIn} title="확대 (+)">＋</button>
          <button className="btn toolbar-fit" onClick={onFitWidth} title="논문을 가운데 영역 너비에 맞춤 (W)">너비 맞춤</button>
          <div className="toolbar-divider" />
          <input type="number" className="page-input" value={currentPage} min={1} max={totalPages}
            onChange={(event) => { const value = Number(event.target.value); if (value >= 1 && value <= totalPages) onPageNavigate(value); }} />
          <span className="page-total">/ {totalPages}</span>
        </div>
      )}
      <div className="toolbar-right">
        {viewMode === 'reader' && <button className={`btn-icon panel-toggle ${leftPanelOpen ? 'active' : ''}`}
          onClick={onToggleLeftPanel} title="목차 패널 열기/접기">☰</button>}
        {viewMode !== 'library' && <button className={`btn panel-toggle ${rightPanelOpen ? 'active' : ''}`}
          onClick={onToggleRightPanel} title="AI 대화 패널 열기/접기">AI</button>}
        {viewMode !== 'library' && <button className="btn" onClick={onExport}>Markdown 내보내기</button>}
        {viewMode === 'web' && <button className="btn" onClick={onCopy}>문서 복사</button>}
        {viewMode === 'web' && <button className="btn" onClick={onExportHtml}>HTML 내보내기</button>}
        <button className="btn-icon" onClick={toggleTheme}>{theme === 'dark' ? '☀' : '☾'}</button>
        <button className="btn-icon" onClick={() => setSettingsOpen(true)}>⚙</button>
      </div>
    </div>
  );
}
