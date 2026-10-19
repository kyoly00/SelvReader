import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './QuickActionModal.css';

export interface InlineTranslation {
  loading: boolean;
  text: string;
  error: string;
}

export function QuickActionModal({
  x, y, onExplain, onHighlight, onTranslate, onAnnotate, onAiQuestion, onClose,
  isImage = false, translation, anchorElement, anchorX, anchorY,
}: {
  x: number;
  y: number;
  onExplain: () => void;
  onHighlight: () => void;
  onTranslate: () => void;
  onAnnotate: (body: string) => void | Promise<void>;
  onAiQuestion: () => void;
  onClose: () => void;
  isImage?: boolean;
  translation?: InlineTranslation;
  anchorElement?: HTMLElement;
  anchorX?: number;
  anchorY?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [position, setPosition] = useState({ left: x + 10, top: y });
  const [anchorVisible, setAnchorVisible] = useState(true);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener('mousedown', handler), 100);
    return () => { window.clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  const copyTranslation = async () => {
    if (!translation?.text) return;
    await navigator.clipboard.writeText(translation.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const saveNote = async () => {
    const body = noteDraft.trim();
    if (!body || noteSaving) return;
    setNoteSaving(true);
    setNoteError('');
    try {
      await onAnnotate(body);
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : '메모를 저장하지 못했습니다.');
      setNoteSaving(false);
    }
  };

  const expanded = Boolean(translation || noteEditorOpen);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const margin = 8;
    const gap = 10;
    const place = () => {
      const anchorRect = anchorElement?.isConnected ? anchorElement.getBoundingClientRect() : null;
      const currentX = anchorRect && anchorX !== undefined ? anchorRect.left + anchorRect.width * anchorX : x;
      const currentY = anchorRect && anchorY !== undefined ? anchorRect.top + anchorRect.height * anchorY : y;
      setAnchorVisible(!anchorRect || (
        currentX >= 0 && currentX <= window.innerWidth &&
        currentY >= 56 && currentY <= window.innerHeight
      ));
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const roomOnRight = window.innerWidth - currentX - gap - margin;
      const preferredLeft = roomOnRight >= width ? currentX + gap : currentX - width - gap;
      const next = {
        left: Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin)),
        top: Math.max(56, Math.min(currentY - height / 2, window.innerHeight - height - margin)),
      };
      setPosition((current) => current.left === next.left && current.top === next.top ? current : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorElement, anchorX, anchorY, expanded, x, y]);

  return (
    <div className={`quick-action-modal glass animate-fade-in-scale ${expanded ? 'expanded-popover' : ''}`} ref={ref}
      style={{
        left: position.left,
        top: position.top,
        visibility: anchorVisible ? 'visible' : 'hidden',
        pointerEvents: anchorVisible ? 'auto' : 'none',
      }}>
      {translation ? (
        <div className="qa-translation">
          <div className="qa-translation-header">
            <strong>번역</strong>
            <button className="qa-close" onClick={onClose} aria-label="번역 닫기">×</button>
          </div>
          {translation.loading && <div className="qa-translation-status"><span className="spinner" /> 번역 중…</div>}
          {translation.error && <div className="qa-translation-error">{translation.error}</div>}
          {translation.text && <div className="qa-translation-text">{translation.text}</div>}
          {!translation.loading && <div className="qa-translation-actions">
            {translation.error && <button className="qa-btn" onClick={onTranslate}>다시 시도</button>}
            {translation.text && <button className="qa-btn" onClick={() => void copyTranslation()}>{copied ? '복사됨' : '복사'}</button>}
          </div>}
        </div>
      ) : noteEditorOpen ? (
        <div className="qa-note-editor">
          <div className="qa-translation-header">
            <strong>메모 작성</strong>
            <button className="qa-close" onClick={onClose} aria-label="메모 닫기">×</button>
          </div>
          <textarea
            className="qa-note-textarea"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void saveNote();
              }
            }}
            placeholder="선택한 내용에 메모를 남기세요"
            rows={4}
            autoFocus
          />
          {noteError && <div className="qa-translation-error">{noteError}</div>}
          <div className="qa-note-actions">
            <span>Ctrl+Enter로 저장</span>
            <button className="qa-btn" onClick={() => { setNoteEditorOpen(false); setNoteError(''); }} disabled={noteSaving}>취소</button>
            <button className="qa-btn qa-note-save" onClick={() => void saveNote()} disabled={!noteDraft.trim() || noteSaving}>
              {noteSaving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="qa-btn" onClick={onExplain}>{isImage ? '이미지 설명' : '설명'}</button>
          {!isImage && <button className="qa-btn" onClick={onHighlight}>하이라이트 <kbd>H</kbd></button>}
          {!isImage && <button className="qa-btn" onClick={onTranslate}>번역 <kbd>T</kbd></button>}
          {!isImage && <button className="qa-btn" onClick={() => setNoteEditorOpen(true)}>메모</button>}
          <button className="qa-btn qa-btn-accent" onClick={onAiQuestion}>AI 질문 <kbd>Q</kbd></button>
        </>
      )}
    </div>
  );
}
