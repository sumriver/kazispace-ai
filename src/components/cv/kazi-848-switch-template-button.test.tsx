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
 * KAZI-848 "换一个" — a lightweight, icon-only override of the backend's
 * auto-selected template (not a template browser, that direction was
 * explicitly rejected). Pins: the button only renders once a CV exists
 * (`canDownload` + `onSwitchTemplate` both present, same gating as the
 * PDF/DOCX buttons), it disables while any export or the switch itself is
 * in flight, and it does not render at all when the caller omits
 * `onSwitchTemplate` (older/other call sites that haven't wired it yet).
 */
describe('KAZI-848 CvPreviewPane switch-template button', () => {
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

  function switchButtons() {
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[aria-label="switchTemplate"]')
    );
  }

  it('does not render when onSwitchTemplate is not provided', async () => {
    await act(async () => {
      root.render(
        <CvPreviewPane
          preview={{ format: 'markdown', content: '# CV' }}
          canDownload
          onDownload={vi.fn()}
        />
      );
    });
    expect(switchButtons()).toHaveLength(0);
  });

  it('does not render when there is nothing to download yet', async () => {
    await act(async () => {
      root.render(
        <CvPreviewPane preview={null} canDownload={false} onSwitchTemplate={vi.fn()} />
      );
    });
    expect(switchButtons()).toHaveLength(0);
  });

  it('renders (desktop + mobile) once a CV exists and the callback is wired', async () => {
    await act(async () => {
      root.render(
        <CvPreviewPane
          preview={{ format: 'markdown', content: '# CV' }}
          canDownload
          onDownload={vi.fn()}
          onSwitchTemplate={vi.fn()}
        />
      );
    });
    // one in the desktop header row, one in the mobile bottom bar.
    expect(switchButtons().length).toBeGreaterThanOrEqual(1);
    for (const button of switchButtons()) {
      expect(button.disabled).toBe(false);
    }
  });

  it('calls onSwitchTemplate when clicked', async () => {
    const onSwitchTemplate = vi.fn();
    await act(async () => {
      root.render(
        <CvPreviewPane
          preview={{ format: 'markdown', content: '# CV' }}
          canDownload
          onDownload={vi.fn()}
          onSwitchTemplate={onSwitchTemplate}
        />
      );
    });
    act(() => {
      switchButtons()[0]?.click();
    });
    expect(onSwitchTemplate).toHaveBeenCalledTimes(1);
  });

  it('disables while the switch itself is in flight', async () => {
    await act(async () => {
      root.render(
        <CvPreviewPane
          preview={{ format: 'markdown', content: '# CV' }}
          canDownload
          onDownload={vi.fn()}
          onSwitchTemplate={vi.fn()}
          isSwitchingTemplate
        />
      );
    });
    for (const button of switchButtons()) {
      expect(button.disabled).toBe(true);
    }
  });

  it('disables the PDF export button while a template switch is in flight', async () => {
    await act(async () => {
      root.render(
        <CvPreviewPane
          preview={{ format: 'markdown', content: '# CV' }}
          canDownload
          onDownload={vi.fn()}
          isExporting={false}
          onSwitchTemplate={vi.fn()}
          isSwitchingTemplate
        />
      );
    });
    const buttons = Array.from(host.querySelectorAll('button'));
    const pdfButton = buttons.find((b) => b.textContent?.includes('PDF') && !b.textContent?.includes('DOCX'));
    expect(pdfButton?.disabled).toBe(true);
  });
});
