import type { AIAction, DocumentBlock } from './extension';
import type { ContextLevel } from '../stores/appStore';

interface SmartContextInput {
  action: AIAction;
  selection: string;
  question: string;
  contextLevel: ContextLevel;
  title?: string;
  abstract?: string;
  currentPage?: number;
  selectionPage?: number;
  pageTexts?: Map<number, string>;
  webBlocks?: DocumentBlock[];
  selectionBlockId?: string;
}

const CONTEXT_LIMITS: Record<ContextLevel, number> = {
  1: 1800,
  2: 5000,
  3: 10000,
};

const BROAD_QUESTION = /(전체|논문|답변|요약|핵심|방법론|method|결과|result|실험|한계|limitation|비교|contribution|기여|결론|구조)/i;
const LOCAL_QUESTION = /(이\s*(단어|용어|문장|표현|부분)|무슨\s*뜻|의미|여기서|문맥에서|번역|문법|왜\s*이렇게)/i;

export function buildSmartContext(input: SmartContextInput): string {
  const selection = normalize(input.selection);
  const question = normalize(input.question);
  const query = `${selection} ${question}`.trim();
  const limit = CONTEXT_LIMITS[input.contextLevel];
  const isTerm = selection.length > 0 && selection.length <= 60 && !/[.!?。！？\n]/.test(selection);
  const localRequest = input.action === 'translate'
    || isTerm
    || (Boolean(selection) && LOCAL_QUESTION.test(question));

  const sourcePassages = input.webBlocks
    ? webPassages(input.webBlocks, selection, input.selectionBlockId)
    : pdfPassages(input.pageTexts || new Map(), input.selectionPage || input.currentPage || 1, selection);
  const compactMetadata = metadataContext(input.title, input.abstract, true);

  // 짧은 요청도 분야와 문서 주제를 잃지 않도록 압축한 제목·개요를 함께 보낸다.
  if (localRequest) {
    const local = sourcePassages.local || sourcePassages.relevant[0] || '';
    return clip([compactMetadata, local].filter(Boolean).join('\n\n'), Math.min(limit, 2400));
  }

  const metadata = metadataContext(input.title, input.abstract, false);
  const wantsBroadContext = input.action === 'ask' && BROAD_QUESTION.test(question);
  const passageCount = wantsBroadContext
    ? (input.contextLevel === 3 ? 5 : 3)
    : (input.contextLevel === 1 ? 1 : input.contextLevel === 2 ? 2 : 4);
  const ranked = rankPassages(sourcePassages.relevant, query).slice(0, passageCount);

  // 문장/문단 설명에는 제목·초록과 해당 문단을, 질문에는 질문과 관련도가 높은 문단을 보낸다.
  const parts = [metadata, sourcePassages.local, ...ranked]
    .map(normalize)
    .filter((value, index, all) => value && all.indexOf(value) === index);
  return clip(parts.join('\n\n'), limit);
}

function metadataContext(title: string | undefined, abstract: string | undefined, compact: boolean) {
  const parts: string[] = [];
  const normalizedTitle = normalize(title);
  const normalizedAbstract = normalize(abstract);
  if (normalizedTitle) parts.push(`[문서 제목]\n${clip(normalizedTitle, 240)}`);
  if (normalizedAbstract) {
    parts.push(`[문서 개요]\n${clip(normalizedAbstract, compact ? 500 : 1000)}`);
  }
  return parts.join('\n');
}

function webPassages(blocks: DocumentBlock[], selection: string, blockId?: string) {
  const index = Math.max(0, blocks.findIndex((block) =>
    (blockId && block.id === blockId) || (selection && block.text.includes(selection)),
  ));
  const local = blocks
    .slice(Math.max(0, index - 1), Math.min(blocks.length, index + 2))
    .map((block) => block.text)
    .join('\n\n');
  return {
    local,
    relevant: blocks.map((block) => block.text).filter(Boolean),
  };
}

function pdfPassages(pageTexts: Map<number, string>, page: number, selection: string) {
  const current = pageTexts.get(page) || '';
  const local = selection ? passageAround(current, selection, 900) : clip(current, 1800);
  const relevant = [...pageTexts.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([pageNumber, text]) => chunkText(text, 1800)
      .map((chunk) => `[${pageNumber}페이지]\n${chunk}`));
  return { local: local ? `[${page}페이지]\n${local}` : '', relevant };
}

function passageAround(text: string, selection: string, radius: number) {
  const haystack = normalize(text);
  const needle = normalize(selection);
  const index = haystack.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return clip(haystack, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(haystack.length, index + needle.length + radius);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`;
}

function chunkText(text: string, size: number) {
  const normalized = normalize(text);
  if (!normalized) return [];
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += size) {
    chunks.push(normalized.slice(start, start + size));
  }
  return chunks;
}

function rankPassages(passages: string[], query: string) {
  const terms = [...new Set((query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []))]
    .filter((term) => !/^(the|and|for|with|this|that|what|how|왜|어떤|대해|설명|알려줘|해주세요)$/.test(term));
  if (terms.length === 0) return passages;
  return passages
    .map((passage, index) => {
      const lower = passage.toLocaleLowerCase();
      const score = terms.reduce((sum, term) => sum + Math.min(4, lower.split(term).length - 1), 0);
      return { passage, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ passage }) => passage);
}

function normalize(value: string | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clip(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}…`;
}
