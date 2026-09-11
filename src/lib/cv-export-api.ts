import { getAuthToken, getDeviceId } from '@/lib/auth';
import { getActiveLanguagePreference } from '@/lib/locale';
import { getTmaClientHeaders } from '@/lib/telegram';
import { regionAwareApiClient } from '@/lib/region';
import type { ApiResponse } from '@/types';

function buildExportHeaders(locale?: string): Record<string, string> {
  const languagePreference =
    locale ??
    getActiveLanguagePreference(
      typeof window !== 'undefined' ? window.location.pathname : undefined
    );

  const headers: Record<string, string> = {
    'X-Device-ID': getDeviceId(),
    'Accept-Language': languagePreference,
    'X-Language-Preference': languagePreference,
    'X-Locale': languagePreference,
    ...getTmaClientHeaders(),
  };
  return headers;
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const starMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1].trim());
    } catch {
      // fall through to basic filename
    }
  }
  const basicMatch = header.match(/filename="([^"]+)"/i);
  if (basicMatch?.[1]) return basicMatch[1].trim();
  const unquotedMatch = header.match(/filename=([^;]+)/i);
  return unquotedMatch?.[1]?.trim().replace(/^"|"$/g, '') ?? null;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseExportError(
  errorData: Record<string, unknown>,
  status: number
): { error: string; errorCode?: string } {
  const detail = errorData.detail;
  const detailMessage =
    typeof detail === 'string'
      ? detail
      : typeof detail === 'object' && detail !== null
        ? (detail as { message?: string }).message
        : undefined;
  const errorCode =
    (typeof detail === 'object' && detail !== null
      ? (detail as { error_code?: string }).error_code
      : undefined) ??
    (typeof errorData.error_code === 'string' ? errorData.error_code : undefined);
  return {
    error:
      detailMessage ||
      (typeof errorData.message === 'string' ? errorData.message : undefined) ||
      `HTTP ${status}`,
    errorCode,
  };
}

export function resolveCvExportErrorMessage(
  error: string | undefined,
  errorCode: string | undefined,
  t: (key: string) => string,
  format: 'pdf' | 'docx' = 'pdf'
): string {
  if (errorCode === 'NOT_FOUND') return t('exportErrorNotFound');
  if (errorCode === 'INTERNAL_SERVER_ERROR' || error?.includes('WeasyPrint')) {
    return t(format === 'docx' ? 'exportErrorUnavailableDocx' : 'exportErrorUnavailable');
  }
  if (errorCode === 'TIMEOUT' || errorCode === 'NETWORK_ERROR') {
    return t(format === 'docx' ? 'exportErrorTimeoutDocx' : 'exportErrorTimeout');
  }
  return error ?? t(format === 'docx' ? 'exportErrorGenericDocx' : 'exportErrorGeneric');
}

async function exportCvDocument(
  docId: number,
  format: 'pdf' | 'docx',
  locale?: string
): Promise<ApiResponse<{ filename: string }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await regionAwareApiClient.fetch(
      `/api/v1/cv/documents/${docId}/${format === 'docx' ? 'export_docx' : 'export'}`,
      {
        method: 'POST',
        headers: buildExportHeaders(locale),
        signal: controller.signal,
        requireSession: Boolean(getAuthToken()),
      }
    );

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const { error, errorCode } = parseExportError(errorData, response.status);
      return { success: false, error, errorCode };
    }

    const blob = await response.blob();
    const filename =
      parseContentDispositionFilename(response.headers.get('Content-Disposition')) ??
      `cv-${docId}.${format}`;
    triggerBlobDownload(blob, filename);
    return { success: true, data: { filename } };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      success: false,
      error: aborted
        ? `${format.toUpperCase()} export timed out`
        : err instanceof Error
          ? err.message
          : 'Network error',
      errorCode: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** POST /api/v1/cv/documents/{doc_id}/export → PDF download (KAZI-101). */
export function exportCvDocumentPdf(
  docId: number,
  locale?: string
): Promise<ApiResponse<{ filename: string }>> {
  return exportCvDocument(docId, 'pdf', locale);
}

/** POST /api/v1/cv/documents/{doc_id}/export_docx → DOCX download (KAZI-818 AC②, KAZI-845). */
export function exportCvDocumentDocx(
  docId: number,
  locale?: string
): Promise<ApiResponse<{ filename: string }>> {
  return exportCvDocument(docId, 'docx', locale);
}

/**
 * POST /api/v1/cv/documents/{doc_id}/template/next → "换一个" (KAZI-848).
 *
 * Zero-LLM, purely local template cycling within the already-classified
 * bucket — the backend auto-picks a template from `target_role` at
 * generation time (KAZI-848), and this is the user's lightweight override,
 * not a template browser/picker (that direction was explicitly rejected).
 * The backend also invalidates any cached PDF for this doc, so the next
 * export re-renders with the new template.
 */
export async function switchCvDocumentTemplate(
  docId: number,
  locale?: string
): Promise<ApiResponse<{ templateBucket: string; templateId: string }>> {
  try {
    const response = await regionAwareApiClient.fetch(
      `/api/v1/cv/documents/${docId}/template/next`,
      {
        method: 'POST',
        headers: buildExportHeaders(locale),
        requireSession: Boolean(getAuthToken()),
      }
    );

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const { error, errorCode } = parseExportError(errorData, response.status);
      return { success: false, error, errorCode };
    }

    const data = (await response.json()) as { template_bucket: string; template_id: string };
    return {
      success: true,
      data: { templateBucket: data.template_bucket, templateId: data.template_id },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
      errorCode: 'NETWORK_ERROR',
    };
  }
}
