import { create } from 'zustand';
import type { WebDocument } from '../utils/extension';

export type ViewMode = 'library' | 'reader' | 'web';
export type ThemeMode = 'dark' | 'light';
export type ContextLevel = 1 | 2 | 3;

export interface PdfDocument {
  id: string;
  name: string;
  data: ArrayBuffer;
  url?: string;
}

interface AppState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  theme: ThemeMode;
  toggleTheme: () => void;
  currentPdf: PdfDocument | null;
  setCurrentPdf: (pdf: PdfDocument | null) => void;
  currentWebDocument: WebDocument | null;
  setCurrentWebDocument: (document: WebDocument | null) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  totalPages: number;
  setTotalPages: (total: number) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  contextLevel: ContextLevel;
  setContextLevel: (level: ContextLevel) => void;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  selectedText: string;
  setSelectedText: (text: string) => void;
  pdfMetadata: { title: string; abstract: string } | null;
  setPdfMetadata: (meta: { title: string; abstract: string } | null) => void;
  pageTexts: Map<number, string>;
  setPageText: (page: number, text: string) => void;
  clearPageTexts: () => void;
}

const storagePrefix = 'selvreader-';

export const useAppStore = create<AppState>((set, get) => ({
  viewMode: 'library',
  setViewMode: (mode) => set({ viewMode: mode }),

  theme: 'dark',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(`${storagePrefix}theme`, next);
    set({ theme: next });
  },

  currentPdf: null,
  setCurrentPdf: (pdf) => set({
    currentPdf: pdf,
    currentWebDocument: null,
    currentPage: 1,
    totalPages: 0,
  }),
  currentWebDocument: null,
  setCurrentWebDocument: (document) => set({
    currentWebDocument: document,
    currentPdf: null,
    currentPage: 1,
    totalPages: 0,
  }),
  currentPage: 1,
  setCurrentPage: (page) => set({ currentPage: page }),
  totalPages: 0,
  setTotalPages: (total) => set({ totalPages: total }),
  zoom: 1,
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(3, zoom)) }),
  zoomIn: () => set((state) => ({ zoom: Math.min(3, state.zoom + 0.15) })),
  zoomOut: () => set((state) => ({ zoom: Math.max(0.25, state.zoom - 0.15) })),
  zoomReset: () => set({ zoom: 1 }),

  contextLevel: 2,
  setContextLevel: (level) => {
    localStorage.setItem(`${storagePrefix}context-level`, String(level));
    set({ contextLevel: level });
  },
  targetLanguage: 'ko',
  setTargetLanguage: (lang) => {
    localStorage.setItem(`${storagePrefix}target-lang`, lang);
    set({ targetLanguage: lang });
  },
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  selectedText: '',
  setSelectedText: (text) => set({ selectedText: text }),
  pdfMetadata: null,
  setPdfMetadata: (meta) => set({ pdfMetadata: meta }),
  pageTexts: new Map(),
  setPageText: (page, text) => set((state) => {
    const next = new Map(state.pageTexts);
    next.set(page, text);
    return { pageTexts: next };
  }),
  clearPageTexts: () => set({ pageTexts: new Map() }),
}));

const savedTheme = localStorage.getItem(`${storagePrefix}theme`) as ThemeMode | null;
if (savedTheme === 'dark' || savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', savedTheme);
  useAppStore.setState({ theme: savedTheme });
}

const savedLevel = Number(localStorage.getItem(`${storagePrefix}context-level`));
if (savedLevel === 1 || savedLevel === 2 || savedLevel === 3) {
  useAppStore.setState({ contextLevel: savedLevel });
}

const savedLang = localStorage.getItem(`${storagePrefix}target-lang`);
if (savedLang) useAppStore.setState({ targetLanguage: savedLang });
