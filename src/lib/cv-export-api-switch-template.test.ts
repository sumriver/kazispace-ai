/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('@/lib/region', () => ({
  regionAwareApiClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { switchCvDocumentTemplate } from '@/lib/cv-export-api';

function jsonHeaders(extra: Record<string, string> = {}) {
  return new Headers({ 'Content-Type': 'application/json', ...extra });
}

/**
 * KAZI-848 "换一个" — same request shape as `exportCvDocument*` but a plain
 * JSON response (bucket + template id), not a blob download. These tests
 * pin down the endpoint it posts to, the snake_case → camelCase response
 * mapping, and that a non-OK response surfaces backend error_code/detail
 * the same way the export functions do.
 */
describe('KAZI-848 switchCvDocumentTemplate', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('POSTs to the template/next endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: jsonHeaders(),
      json: async () => ({ template_bucket: 'modern', template_id: 'corporate' }),
    });

    await switchCvDocumentTemplate(42, 'en');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/cv/documents/42/template/next');
    expect(init).toMatchObject({ method: 'POST' });
  });

  it('maps the snake_case response to templateBucket/templateId', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: jsonHeaders(),
      json: async () => ({ template_bucket: 'executive', template_id: 'luxe' }),
    });

    const res = await switchCvDocumentTemplate(42, 'en');

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ templateBucket: 'executive', templateId: 'luxe' });
  });

  it('surfaces backend error_code/detail on a non-OK response (e.g. no resume yet)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      headers: jsonHeaders(),
      json: async () => ({ detail: { message: 'no resume yet', error_code: 'VALIDATION_ERROR' } }),
    });

    const res = await switchCvDocumentTemplate(42, 'en');

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('VALIDATION_ERROR');
  });

  it('returns a NETWORK_ERROR result instead of throwing on a fetch rejection', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));

    const res = await switchCvDocumentTemplate(42, 'en');

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('NETWORK_ERROR');
  });
});
