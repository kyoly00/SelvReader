import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFootnotes from 'remark-footnotes';
import rehypeKatex from 'rehype-katex';
import type { ChatMessageRecord, AnnotationRecord } from '../utils/db';
import { MermaidDiagram } from './MermaidDiagram';
import { CodeBlock } from './CodeBlock';
import { remarkCallouts } from '../utils/remarkCallouts';
import './AIPanel.css';

interface Props {
  messages: ChatMessageRecord[];
  notes: AnnotationRecord[];
  loading: boolean;
  error: string;
  attachments: Array<{
    id: string;
    text: string;
    imageDataUrl?: string;
  }>;
  focusRequest: number;
  onAsk: (question: string) => void;
  onRemoveAttachment: (id: string) => void;
  onDeleteNote: (id: string) => void;
}

export function AIPanel({ messages, notes, loading, error, attachments, focusRequest, onAsk, onRemoveAttachment, onDeleteNote }: Props) {
  const [tab, setTab] = useState<'chat' | 'notes'>('chat');
  const [question, setQuestion] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const timer = window.setTimeout(() => {
      setTab('chat');
      requestAnimationFrame(() => textareaRef.current?.focus());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusRequest]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [loading, messages]);

  const submit = () => {
    const value = question.trim();
    if (!value || loading) return;
    onAsk(value);
    setQuestion('');
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-tabs">
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>AI 대화</button>
        <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>메모 {notes.length}</button>
      </div>

      {tab === 'chat' ? (
        <>
          <div className="ai-messages" ref={messagesRef}>
            {messages.length === 0 && (
              <div className="ai-empty">
                <strong>선택한 내용을 깊이 읽어보세요.</strong>
                <span>번역·설명 버튼을 누르거나 아래에 질문을 입력하세요.</span>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`ai-message ${message.role}`}>
                <div className="message-role">{message.role === 'user' ? '나' : `${message.provider || 'AI'} · ${message.model || ''}`}</div>
                {(message.imageDataUrls?.length ? message.imageDataUrls : message.imageDataUrl ? [message.imageDataUrl] : []).map((image, index) => (
                  <img key={`${message.id}-image-${index}`} className="message-image" src={image} alt={`선택한 PDF 영역 ${index + 1}`} />
                ))}
                {message.selection && <blockquote>{message.selection}</blockquote>}
                <RichMarkdown>{message.content}</RichMarkdown>
                {message.role === 'assistant' && (message.inputTokens || message.outputTokens) ? (
                  <small>{message.inputTokens || 0} in · {message.outputTokens || 0} out</small>
                ) : null}
              </article>
            ))}
            {loading && <div className="ai-thinking"><span className="spinner" /> 답변 생성 중…</div>}
            {error && <div className="ai-error">{error}</div>}
          </div>
          <div className="ai-composer">
            {attachments.length > 0 && <div className="composer-attachments">
              {attachments.map((attachment, index) => (
                <div className="selection-preview" key={attachment.id}>
                  <button
                    type="button"
                    className="attachment-remove"
                    aria-label={`${index + 1}번째 선택 제거`}
                    title="선택 제거"
                    onClick={() => onRemoveAttachment(attachment.id)}
                  >×</button>
                  {attachment.imageDataUrl && (
                    <img className="composer-image" src={attachment.imageDataUrl} alt={`첨부할 PDF 영역 ${index + 1}`} />
                  )}
                  <span>{attachment.text}</span>
                  <small>{attachment.imageDataUrl ? `이미지 영역 ${index + 1}` : `선택한 텍스트 ${index + 1}`}</small>
                </div>
              ))}
            </div>}
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={attachments.length ? '선택한 내용에 대해 무엇이 궁금한가요?' : '문서에 질문하기'}
            />
            <button className="btn btn-accent" onClick={submit} disabled={!question.trim() || loading}>질문</button>
          </div>
        </>
      ) : (
        <div className="notes-list">
          {notes.length === 0 && <div className="ai-empty">아직 메모가 없습니다.</div>}
          {notes.map((note) => (
            <article key={note.id} className="note-card">
              <button type="button" className="note-delete" onClick={() => onDeleteNote(note.id)}
                aria-label="메모 삭제" title="메모 삭제">×</button>
              {note.quote && <blockquote>{note.quote}</blockquote>}
              <RichMarkdown>{note.body}</RichMarkdown>
              {note.page && <small>{note.page}페이지</small>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function RichMarkdown({ children }: { children: string }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath, remarkFootnotes as unknown as typeof remarkGfm, remarkCallouts]}
    rehypePlugins={[rehypeKatex]}
    components={{
      pre: ({ children: codeChildren, ...props }) => {
        const child = Children.toArray(codeChildren)[0];
        if (isValidElement<{ className?: string; children?: ReactNode }>(child)
          && /(?:^|\s)language-mermaid(?:\s|$)/.test(child.props.className || '')) {
          return <MermaidDiagram source={String(child.props.children || '').replace(/\n$/, '')} />;
        }
        if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
          const language = child.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] || 'text';
          return <CodeBlock source={String(child.props.children || '').replace(/\n$/, '')} language={language} />;
        }
        return <pre {...props}>{codeChildren}</pre>;
      },
    }}
  >{children}</ReactMarkdown>;
}
