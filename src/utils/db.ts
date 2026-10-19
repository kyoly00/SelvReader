const DB_NAME = 'selvreader';
const DB_VERSION = 2;

export interface PdfMeta {
  id: string;
  name: string;
  title?: string;
  sourceUrl?: string;
  addedAt: number;
  lastOpened: number;
  size: number;
  totalPages?: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HighlightRecord {
  id: string;
  documentId: string;
  page?: number;
  quote: string;
  color: 'yellow' | 'green' | 'blue' | 'purple';
  rects?: NormalizedRect[];
  blockId?: string;
  start?: number;
  end?: number;
  createdAt: number;
}

export interface AnnotationRecord {
  id: string;
  documentId: string;
  page?: number;
  quote: string;
  body: string;
  rects?: NormalizedRect[];
  blockId?: string;
  start?: number;
  end?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageRecord {
  id: string;
  documentId: string;
  role: 'user' | 'assistant';
  content: string;
  selection?: string;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of ['highlights', 'annotations', 'library', 'pdfFiles', 'chatMessages']) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function dbDeleteDocument(documentId: string): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(
    ['library', 'pdfFiles', 'highlights', 'annotations', 'chatMessages'],
    'readwrite',
  );
  transaction.objectStore('library').delete(documentId);
  transaction.objectStore('pdfFiles').delete(documentId);

  for (const storeName of ['highlights', 'annotations', 'chatMessages']) {
    const store = transaction.objectStore(storeName);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.documentId === documentId) cursor.delete();
      cursor.continue();
    };
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function dbGetByDocument<T extends { documentId: string }>(
  storeName: string,
  documentId: string,
): Promise<T[]> {
  const all = await dbGetAll<T>(storeName);
  return all.filter((item) => item.documentId === documentId);
}
