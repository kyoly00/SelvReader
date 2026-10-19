export async function createPdfId(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `pdf-${hash}`;
}

export function pdfNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split('/').pop() || 'document.pdf');
    return name.toLowerCase().endsWith('.pdf') ? name : `${name || 'document'}.pdf`;
  } catch {
    return 'document.pdf';
  }
}

export function looksLikePdf(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 5));
  return String.fromCharCode(...bytes) === '%PDF-';
}

const MAX_PDF_SIZE = 250 * 1024 * 1024;

/** Downloads the original bytes so PDF.js never depends on a site's embedded viewer. */
export async function downloadPdf(inputUrl: string): Promise<ArrayBuffer> {
  const candidates = pdfDownloadCandidates(inputUrl);
  const failures: string[] = [];

  for (const url of candidates) {
    for (const credentials of ['include', 'omit'] as RequestCredentials[]) {
      try {
        const response = await fetch(url, {
          credentials,
          cache: 'no-store',
          redirect: 'follow',
          headers: { Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const declaredSize = Number(response.headers.get('content-length') || 0);
        if (declaredSize > MAX_PDF_SIZE) throw new Error('250MB를 초과합니다');
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_PDF_SIZE) throw new Error('250MB를 초과합니다');
        if (!looksLikePdf(buffer)) throw new Error('PDF 원본 대신 HTML 응답을 받았습니다');
        return buffer;
      } catch (error) {
        failures.push(`${new URL(url).hostname}: ${(error as Error).message}`);
      }
    }
  }

  throw new Error(`PDF 원본을 다운로드하지 못했습니다. ${failures.at(-1) || '주소를 확인하세요.'}`);
}

function pdfDownloadCandidates(inputUrl: string): string[] {
  const parsed = new URL(inputUrl);
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) {
    throw new Error('HTTP(S) 또는 file URL만 지원합니다.');
  }
  const candidates = [parsed.href];
  if (/^(?:www\.)?arxiv\.org$/i.test(parsed.hostname)) {
    const abstractId = parsed.pathname.match(/^\/abs\/(.+)$/)?.[1];
    if (abstractId) candidates.unshift(`https://arxiv.org/pdf/${abstractId}`);
    if (/^\/pdf\//.test(parsed.pathname) && !/\.pdf$/i.test(parsed.pathname)) {
      candidates.push(`${parsed.origin}${parsed.pathname}.pdf${parsed.search}`);
    }
  }
  return [...new Set(candidates)];
}
