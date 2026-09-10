/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('@/lib/region', () => ({
  regionAwareApiClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { exportCvDocumentDocx, resolveCvExportErrorMessage } from '@/lib/cv-export-api';

function jsonHeaders(extra: Record<string, string> = {}) {
  return new Headers({ 'Content-Type': 'application/json', ...extra });
}

/**
 * KAZI-845: `export_docx` is a straight sibling of the existing PDF export
 * (KAZI-101) -- same request/response shape, different endpoint and
 * filename extension. These tests pin down the two things that differ from
 * the PDF path: the endpoint it posts to, and that error copy resolves to
 * the DOCX-flavored translation keys instead of the PDF ones.
 */
describe('KAZI-845 exportCvDocumentDocx', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // jsdom doesn't implement blob URLs -- triggerBlobDownload only needs
    // these to exist, not to do anything.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('POSTs to the export_docx endpoint (not export/PDF)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: jsonHeaders(),
      blob: async () => new Blob(['docx bytes']),
    });

    await exportCvDocumentDocx(42, 'en');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/cv/documents/42/export_docx');
    expect(init).toMatchObject({ method: 'POST' });
  });

  it('falls back to a cv-{id}.docx filename when no Content-Disposition header is present', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: jsonHeaders(),
      blob: async () => new Blob(['docx bytes']),
    });

    const res = await exportCvDocumentDocx(42, 'en');

    expect(res.success).toBe(true);
    expect(res.success && res.data.filename).toBe('cv-42.docx');
  });

  it('surfaces backend error_code/detail on a non-OK response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      headers: jsonHeaders(),
      json: async () => ({ detail: { message: 'not found', error_code: 'NOT_FOUND' } }),
    });

    const res = await exportCvDocumentDocx(42, 'en');

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });
});

describe('KAZI-845 resolveCvExportErrorMessage format awareness', () => {
  const t = (key: string) => key;

  it('defaults to the PDF-flavored keys when format is omitted', () => {
    expect(resolveCvExportErrorMessage(undefined, 'TIMEOUT', t)).toBe('exportErrorTimeout');
    expect(resolveCvExportErrorMessage(undefined, 'INTERNAL_SERVER_ERROR', t)).toBe(
      'exportErrorUnavailable'
    );
  });

  it('resolves the DOCX-flavored keys when format is "docx"', () => {
    expect(resolveCvExportErrorMessage(undefined, 'TIMEOUT', t, 'docx')).toBe(
      'exportErrorTimeoutDocx'
    );
    expect(resolveCvExportErrorMessage(undefined, 'INTERNAL_SERVER_ERROR', t, 'docx')).toBe(
      'exportErrorUnavailableDocx'
    );
    expect(resolveCvExportErrorMessage(undefined, undefined, t, 'docx')).toBe(
      'exportErrorGenericDocx'
    );
  });

  it('NOT_FOUND stays a single shared key regardless of format', () => {
    expect(resolveCvExportErrorMessage(undefined, 'NOT_FOUND', t)).toBe('exportErrorNotFound');
    expect(resolveCvExportErrorMessage(undefined, 'NOT_FOUND', t, 'docx')).toBe(
      'exportErrorNotFound'
    );
  });
});
