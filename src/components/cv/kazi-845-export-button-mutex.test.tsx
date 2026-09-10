/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { CvPreviewPane } from '@/components/cv/cv-preview-pane';

/**
 * Review on kazispace-ai#221 (KAZI-845): the hook-level guard in
 * use-cv-agent.ts already blocks a concurrent PDF+DOCX export (silent
 * no-op, no toast), but the buttons themselves only disabled on their own
 * isExporting flag -- clicking the "other" format's button while one
 * export was in flight looked like nothing happened. Pins the fix: both
 * buttons disable the moment either export starts.
 */
describe('KAZI-845 CvPreviewPane export button mutual exclusion', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('disables the DOCX button while the PDF export is in flight', async () => {
    await act(async () => {
      root.render(
        <CvPreviewPane
          preview={{ format: 'markdown', content: '# CV' }}
          canDownload
          onDownload={() => undefined}
          isExporting
          canDownloadDocx
          onDownloadDocx={vi.fn()}
          isExportingDocx={false}
        />
      );
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    const docxButton = buttons.find((b) => b.textContent?.includes('DOCX'));
    expect(docxButton).toBeDefined();
    expect(docxButton?.disabled).toBe(true);
  });

  it('disables the PDF button while the DOCX export is in flight', async () => {
    await act(async () => {
      root.render(
        <CvPreviewPane
          preview={{ format: 'markdown', content: '# CV' }}
          canDownload
          onDownload={vi.fn()}
          isExporting={false}
          canDownloadDocx
          onDownloadDocx={() => undefined}
          isExportingDocx
        />
      );
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    const pdfButton = buttons.find((b) => b.textContent?.includes('PDF') && !b.textContent?.includes('DOCX'));
    expect(pdfButton).toBeDefined();
    expect(pdfButton?.disabled).toBe(true);
  });

  it('leaves both buttons enabled when neither export is in flight', async () => {
    await act(async () => {
      root.render(
        <CvPreviewPane
          preview={{ format: 'markdown', content: '# CV' }}
          canDownload
          onDownload={vi.fn()}
          isExporting={false}
          canDownloadDocx
          onDownloadDocx={vi.fn()}
          isExportingDocx={false}
        />
      );
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    const pdfButton = buttons.find((b) => b.textContent?.includes('PDF') && !b.textContent?.includes('DOCX'));
    const docxButton = buttons.find((b) => b.textContent?.includes('DOCX'));
    expect(pdfButton?.disabled).toBe(false);
    expect(docxButton?.disabled).toBe(false);
  });
});
