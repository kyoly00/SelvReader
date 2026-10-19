import { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import './CodeBlock.css';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

export function CodeBlock({ source, language = 'text' }: { source: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => {
    const normalized = language.toLowerCase();
    try {
      return hljs.getLanguage(normalized)
        ? hljs.highlight(source, { language: normalized, ignoreIllegals: true }).value
        : escapeHtml(source);
    } catch {
      return escapeHtml(source);
    }
  }, [language, source]);

  const copy = async () => {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return <div className="code-block">
    <div className="code-block-toolbar">
      <span>{language || 'text'}</span>
      <button type="button" onClick={() => void copy()} aria-label="코드 복사">{copied ? '복사됨' : '복사'}</button>
    </div>
    <pre><code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
  </div>;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
