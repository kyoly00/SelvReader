import { useState } from 'react';
import type { OutlineItem } from './PdfViewer';
import './TocPanel.css';

function TocItem({ item, depth }: { item: OutlineItem; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = Boolean(item.items?.length);
  const navigate = () => {
    const handler = (window as unknown as { __selvreaderPdfNavigate?: (dest: unknown) => void }).__selvreaderPdfNavigate;
    if (item.dest) handler?.(item.dest);
  };
  return (
    <div className="toc-item-group">
      <button className="toc-item" style={{ paddingLeft: `${12 + depth * 16}px` }} onClick={navigate} title={item.title}>
        {hasChildren && <span className={`toc-arrow ${expanded ? 'expanded' : ''}`} onClick={(event) => {
          event.stopPropagation(); setExpanded((value) => !value);
        }}>▸</span>}
        <span className="toc-title">{item.title}</span>
      </button>
      {hasChildren && expanded && <div className="toc-children">
        {item.items.map((child, index) => <TocItem key={`${child.title}-${index}`} item={child} depth={depth + 1} />)}
      </div>}
    </div>
  );
}

export function TocPanel({ outline }: { outline: OutlineItem[] }) {
  return (
    <div className="toc-panel">
      <div className="toc-header">목차</div>
      {outline.length === 0 ? <div className="toc-empty">이 PDF에는 목차 정보가 없습니다.</div> : (
        <div className="toc-list">{outline.map((item, index) => <TocItem key={`${item.title}-${index}`} item={item} depth={0} />)}</div>
      )}
    </div>
  );
}
