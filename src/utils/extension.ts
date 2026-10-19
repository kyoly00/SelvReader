export type AIAction = 'explain' | 'translate' | 'ask';
export type AIProviderName = 'gemini' | 'openai';

export interface ExtensionSettings {
  provider: AIProviderName;
  geminiModel: string;
  openaiModel: string;
  targetLanguage: string;
  contextLevel: 1 | 2 | 3;
  rememberKey: boolean;
  enabled: boolean;
  autoOpenPdf: boolean;
  hasApiKey: boolean;
}

export interface AIRequest {
  action: AIAction;
  selection: string;
  context?: string;
  question?: string;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
    selection?: string;
  }>;
  memory?: string;
}

export interface AIResult {
  text: string;
  provider: AIProviderName;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface DocumentBlock {
  id: string;
  order: number;
  kind: 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'table' | 'math' | 'image' | 'diagram' | 'box' | 'annotation' | 'html';
  text: string;
  markdown?: string;
  language?: string;
  html?: string;
}

export interface DocumentCitation {
  id: string;
  label: string;
  title: string;
  url: string;
  hostname: string;
  snippet?: string;
  kind?: 'citation' | 'footnote';
}

export interface DocumentDiagnostic {
  level: 'info' | 'warning';
  code: string;
  message: string;
}

export interface WebDocument {
  schemaVersion?: number;
  id: string;
  source: 'chatgpt-answer' | 'gemini-answer' | 'web-selection';
  sourceUrl?: string;
  title: string;
  selectedText?: string;
  blocks: DocumentBlock[];
  citations?: DocumentCitation[];
  diagnostics?: DocumentDiagnostic[];
  createdAt: number;
  updatedAt: number;
}

interface ExtensionResponse {
  ok: boolean;
  error?: string;
  settings?: ExtensionSettings;
  result?: AIResult;
  document?: WebDocument | null;
  documents?: WebDocument[];
  id?: string;
}

interface ChromeRuntimeLike {
  id?: string;
  sendMessage(message: unknown): Promise<ExtensionResponse>;
}

interface ChromeLike {
  runtime?: ChromeRuntimeLike;
}

function getRuntime(): ChromeRuntimeLike | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome?.runtime;
}

export function isExtension(): boolean {
  return Boolean(getRuntime()?.id);
}

export async function sendExtensionMessage(message: unknown): Promise<ExtensionResponse> {
  const runtime = getRuntime();
  if (!runtime?.id) throw new Error('SelvReader 확장으로 실행해 주세요.');
  const response = await runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '확장 요청에 실패했습니다.');
  return response;
}

export async function getExtensionSettings(): Promise<ExtensionSettings> {
  const response = await sendExtensionMessage({ type: 'GET_SETTINGS' });
  if (!response.settings) throw new Error('설정을 불러오지 못했습니다.');
  return response.settings;
}

export async function saveExtensionSettings(
  settings: Omit<ExtensionSettings, 'hasApiKey'>,
  apiKey: string,
): Promise<ExtensionSettings> {
  const response = await sendExtensionMessage({ type: 'SAVE_SETTINGS', settings, apiKey });
  if (!response.settings) throw new Error('설정을 저장하지 못했습니다.');
  return response.settings;
}

export async function requestAI(request: AIRequest): Promise<AIResult> {
  const response = await sendExtensionMessage({ type: 'AI_REQUEST', request });
  if (!response.result) throw new Error('AI 응답이 비어 있습니다.');
  return response.result;
}

export async function getWebDocument(id: string): Promise<WebDocument | null> {
  const response = await sendExtensionMessage({ type: 'GET_WEB_DOCUMENT', id });
  return response.document || null;
}

export async function listWebDocuments(): Promise<WebDocument[]> {
  const response = await sendExtensionMessage({ type: 'LIST_WEB_DOCUMENTS' });
  return response.documents || [];
}

export async function deleteWebDocument(id: string): Promise<void> {
  await sendExtensionMessage({ type: 'DELETE_WEB_DOCUMENT', id });
}

export async function saveWebDocument(document: WebDocument): Promise<WebDocument> {
  const response = await sendExtensionMessage({ type: 'SAVE_WEB_DOCUMENT', document });
  if (!response.document) throw new Error('문서를 저장하지 못했습니다.');
  return response.document;
}
