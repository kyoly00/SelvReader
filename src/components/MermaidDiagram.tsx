import { useEffect, useId, useState } from 'react';

let mermaidModule: Promise<(typeof import('mermaid'))['default']> | null = null;

function getMermaid() {
  if (!mermaidModule) {
    mermaidModule = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: {
          primaryColor: '#e5f3ff',
          primaryTextColor: '#0d0d0d',
          primaryBorderColor: '#539af8',
          lineColor: '#71717a',
          secondaryColor: '#f5faff',
          tertiaryColor: '#f3f3f3',
          fontFamily: 'system-ui, sans-serif',
        },
      });
      return mermaid;
    });
  }
  return mermaidModule;
}

export function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const id = `selvreader-mermaid-${reactId.replace(/[^a-z0-9]/gi, '')}-${Date.now()}`;
    void getMermaid()
      .then((mermaid) => mermaid.render(id, source))
      .then((result) => {
        if (active) setSvg(result.svg);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [reactId, source]);

  if (error) return <div className="mermaid-error"><strong>Mermaid 렌더링 실패</strong><pre><code>{source}</code></pre><small>{error}</small></div>;
  if (!svg) return <div className="mermaid-loading"><span className="spinner" /> 다이어그램 렌더링 중…</div>;
  return <div className="mermaid-diagram" role="img" aria-label="Mermaid 다이어그램"
    data-mermaid-source={source} dangerouslySetInnerHTML={{ __html: svg }} />;
}
