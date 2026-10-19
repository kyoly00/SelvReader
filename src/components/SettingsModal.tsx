import { useEffect, useState } from 'react';
import { useAppStore, type ContextLevel } from '../stores/appStore';
import {
  getExtensionSettings,
  requestAI,
  saveExtensionSettings,
  type AIProviderName,
  type ExtensionSettings,
} from '../utils/extension';
import './SettingsModal.css';

const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — 최신 균형 (무료 할당량)' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash — 속도·품질 균형 (무료 할당량)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — 저비용 추천 (무료 할당량)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite — 번역·단순 처리 (무료 할당량)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — 최저 유료 단가 (무료 할당량)' },
] as const;

const OPENAI_MODELS = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna — 최신·최저비용 추천' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna — 저비용 장문 처리' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano — 단순 설명·추출' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini — 품질·비용 균형' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra — 고품질 균형' },
] as const;

const defaultSettings: ExtensionSettings = {
  provider: 'gemini',
  geminiModel: 'gemini-3.5-flash-lite',
  openaiModel: 'gpt-5.6-terra',
  targetLanguage: 'ko',
  contextLevel: 2,
  rememberKey: false,
  enabled: true,
  autoOpenPdf: true,
  hasApiKey: false,
};

export function SettingsModal() {
  const { setSettingsOpen, setContextLevel, setTargetLanguage } = useAppStore();
  const [settings, setSettings] = useState(defaultSettings);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const modelOptions = settings.provider === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS;
  const selectedModel = settings.provider === 'gemini' ? settings.geminiModel : settings.openaiModel;
  const selectedModelIsKnown = modelOptions.some((model) => model.id === selectedModel);

  useEffect(() => {
    void getExtensionSettings()
      .then(setSettings)
      .catch((error: Error) => setStatus(error.message));
  }, []);

  const update = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      const saved = await saveExtensionSettings(toStoredSettings(settings), apiKey);
      setSettings(saved);
      setContextLevel(saved.contextLevel);
      setTargetLanguage(saved.targetLanguage);
      setApiKey('');
      setStatus('설정을 저장했습니다.');
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setSaving(true);
    setStatus('연결 확인 중…');
    try {
      const saved = await saveExtensionSettings(toStoredSettings(settings), apiKey);
      setSettings(saved);
      setApiKey('');
      const result = await requestAI({
        action: 'ask',
        selection: 'SelvReader connection test',
        question: '한 단어로 OK라고 답하세요.',
      });
      setStatus(`${result.provider} · ${result.model} 연결 성공`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
      <section className="settings-modal glass" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-header">
          <div>
            <h2>SelvReader 설정</h2>
            <p>개인 API 키는 확장 service worker에서만 사용됩니다.</p>
          </div>
          <button className="btn-icon" onClick={() => setSettingsOpen(false)} aria-label="닫기">×</button>
        </header>

        <div className="settings-body">
          <label>
            AI 공급자
            <select value={settings.provider} onChange={(event) => update('provider', event.target.value as AIProviderName)}>
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>

          <label>
            API 키
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasApiKey ? '저장된 키가 있습니다. 변경할 때만 입력' : 'API 키 입력'}
              autoComplete="off"
            />
          </label>

          {settings.provider === 'gemini' ? (
            <label>
              Gemini 모델
              <select value={settings.geminiModel} onChange={(event) => update('geminiModel', event.target.value)}>
                {!selectedModelIsKnown && <option value={selectedModel}>{selectedModel} (현재 저장값)</option>}
                {GEMINI_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>
          ) : (
            <label>
              OpenAI 모델
              <select value={settings.openaiModel} onChange={(event) => update('openaiModel', event.target.value)}>
                {!selectedModelIsKnown && <option value={selectedModel}>{selectedModel} (현재 저장값)</option>}
                {OPENAI_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>
          )}
          <p className="settings-model-note">
            {settings.provider === 'gemini'
              ? '무료 할당량과 요청 제한은 Google 프로젝트·지역에 따라 달라질 수 있으며, 무료 티어 요청은 Google 제품 개선에 사용될 수 있습니다.'
              : 'OpenAI API는 무료 할당량이 없습니다. Luna·Nano 순으로 비용을 우선하고, Mini·Terra는 품질을 더 우선합니다.'}
          </p>

          <div className="settings-row">
            <label>
              번역 언어
              <select value={settings.targetLanguage} onChange={(event) => update('targetLanguage', event.target.value)}>
                <option value="ko">한국어</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
              </select>
            </label>
            <label>
              AI 문맥 상한
              <select
                value={settings.contextLevel}
                onChange={(event) => update('contextLevel', Number(event.target.value) as ContextLevel)}
              >
                <option value={1}>최소</option>
                <option value={2}>자동 (권장)</option>
                <option value={3}>넓게</option>
              </select>
            </label>
          </div>

          <label className="check-label">
            <input
              type="checkbox"
              checked={settings.rememberKey}
              onChange={(event) => update('rememberKey', event.target.checked)}
            />
            이 기기에 API 키 기억하기
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => update('enabled', event.target.checked)}
            />
            웹 답변 선택 도구 사용
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={settings.autoOpenPdf}
              onChange={(event) => update('autoOpenPdf', event.target.checked)}
            />
            웹 PDF를 SelvReader로 자동 열기
          </label>

          <p className="settings-warning">
            키 기억을 켜면 암호화되지 않은 확장 로컬 저장소에 보관됩니다. 개인용 Chrome 프로필에서만 사용하세요.
          </p>
          {status && <p className="settings-status">{status}</p>}
        </div>

        <footer className="settings-footer">
          <button className="btn" onClick={test} disabled={saving}>연결 테스트</button>
          <button className="btn btn-accent" onClick={save} disabled={saving}>저장</button>
        </footer>
      </section>
    </div>
  );
}

function toStoredSettings(settings: ExtensionSettings): Omit<ExtensionSettings, 'hasApiKey'> {
  return {
    provider: settings.provider,
    geminiModel: settings.geminiModel,
    openaiModel: settings.openaiModel,
    targetLanguage: settings.targetLanguage,
    contextLevel: settings.contextLevel,
    rememberKey: settings.rememberKey,
    enabled: settings.enabled,
    autoOpenPdf: settings.autoOpenPdf,
  };
}
