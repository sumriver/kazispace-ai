'use client';

import type { ReactNode } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MarkdownContent } from '@/components/clinic/markdown-content';
import { Button } from '@/components/ui/button';
import type { CvPreviewContent } from '@/lib/cv-api';
import { cn } from '@/lib/utils';

interface CvPreviewPaneProps {
  preview: CvPreviewContent | null;
  isLoading?: boolean;
  footer?: ReactNode;
  canDownload?: boolean;
  isExporting?: boolean;
  onDownload?: () => void;
  /** KAZI-845: DOCX sibling of the PDF download — backend only surfaces it once `resume` is populated. */
  canDownloadDocx?: boolean;
  isExportingDocx?: boolean;
  onDownloadDocx?: () => void;
  /** KAZI-848 "换一个" — lightweight override of the auto-selected template; only shown once a CV exists. */
  isSwitchingTemplate?: boolean;
  onSwitchTemplate?: () => void;
  jobSubtitle?: string;
  panelId?: string;
  className?: string;
}

export function CvPreviewPane({
  preview,
  isLoading,
  footer,
  canDownload,
  isExporting,
  onDownload,
  canDownloadDocx,
  isExportingDocx,
  onDownloadDocx,
  isSwitchingTemplate,
  onSwitchTemplate,
  jobSubtitle,
  panelId,
  className,
}: CvPreviewPaneProps) {
  const t = useTranslations('cv');
  const showPdfButton = canDownload && onDownload;
  const showDocxButton = canDownloadDocx && onDownloadDocx;
  const showSwitchTemplate = canDownload && onSwitchTemplate;
  const switchTemplateLabel = isSwitchingTemplate ? t('switchingTemplate') : t('switchTemplate');
  // KAZI-845 review: the hook already blocks a concurrent PDF+DOCX export
  // (silent no-op, no toast) -- mirror that in the UI so neither button
  // stays clickable while the *other* format is in flight.
  const isExportingAny =
    Boolean(isExporting) || Boolean(isExportingDocx) || Boolean(isSwitchingTemplate);

  return (
    <aside
      id={panelId}
      role="tabpanel"
      aria-labelledby={panelId ? 'cv-tab-resume' : undefined}
      className={cn(
        // KAZI-662: was a bare #ECEEF2 literal — merged into workspace-bg, a
        // passive canvas backdrop behind the CV document preview, closest to
        // this near-neighbor value.
        'flex flex-col min-h-0 min-w-0 bg-workspace-bg',
        'lg:w-[min(440px,40vw)] lg:shrink-0 lg:border-l lg:border-gray-200/80',
        className
      )}
    >
      <div className="shrink-0 px-4 h-12 flex items-center justify-between bg-white border-b border-gray-200/80">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-kazi-navy">{t('previewTitle')}</h2>
          {jobSubtitle ? (
            <p className="text-[11px] text-gray-500 truncate">{jobSubtitle}</p>
          ) : null}
        </div>
        {showPdfButton || showDocxButton ? (
          <div className="hidden lg:flex items-center gap-1.5">
            {showSwitchTemplate ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={isExportingAny}
                onClick={onSwitchTemplate}
                title={switchTemplateLabel}
                aria-label={switchTemplateLabel}
                data-testid="cv-switch-template-button"
                className="h-8 w-8 text-gray-500 hover:text-kazi-navy"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isSwitchingTemplate && 'animate-spin')} />
              </Button>
            ) : null}
            {showPdfButton ? (
              <ExportButton
                isExporting={isExporting}
                disabled={isExportingAny}
                loadingLabel={t('exportingPdf')}
                onDownload={onDownload!}
                className="h-8 gap-1.5 text-xs"
                variant="outline"
                label="PDF"
              />
            ) : null}
            {showDocxButton ? (
              <ExportButton
                isExporting={isExportingDocx}
                disabled={isExportingAny}
                loadingLabel={t('exportingDocx')}
                onDownload={onDownloadDocx!}
                className="h-8 gap-1.5 text-xs"
                variant="outline"
                label="DOCX"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-7 w-7 text-primary animate-spin mb-3" />
            <p className="text-sm text-gray-500">{t('previewLoading')}</p>
          </div>
        ) : preview ? (
          <div
            className={cn(
              'mx-auto max-w-[480px] min-h-[640px] bg-white',
              'shadow-[0_2px_16px_rgba(13,27,42,0.08)] rounded-sm',
              'px-8 py-10 sm:px-10 sm:py-12',
              'prose prose-sm sm:prose-base max-w-none text-gray-800',
              'prose-headings:text-kazi-navy prose-headings:font-semibold'
            )}
          >
            {preview.format === 'html' ? (
              <div dangerouslySetInnerHTML={{ __html: preview.content }} />
            ) : (
              <MarkdownContent content={preview.content} />
            )}
          </div>
        ) : canDownload ? (
          <EmptyState
            message={t('previewPendingDownload')}
            action={
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {showPdfButton ? (
                  <ExportButton
                    isExporting={isExporting}
                    disabled={isExportingAny}
                    loadingLabel={t('exportingPdf')}
                    onDownload={onDownload!}
                    className="gap-2"
                    label={t('downloadPdf')}
                  />
                ) : null}
                {showDocxButton ? (
                  <ExportButton
                    isExporting={isExportingDocx}
                    disabled={isExportingAny}
                    loadingLabel={t('exportingDocx')}
                    onDownload={onDownloadDocx!}
                    className="gap-2"
                    variant="outline"
                    label={t('downloadDocx')}
                  />
                ) : null}
              </div>
            }
          />
        ) : (
          <EmptyState message={t('previewEmpty')} hint={t('previewEmptyHint')} />
        )}
      </div>

      {footer}

      {showPdfButton || showDocxButton ? (
        <div className="lg:hidden shrink-0 flex gap-2 p-4 bg-white border-t border-gray-200/80 safe-area-pb">
          {showSwitchTemplate ? (
            <Button
              variant="outline"
              size="icon"
              disabled={isExportingAny}
              onClick={onSwitchTemplate}
              title={switchTemplateLabel}
              aria-label={switchTemplateLabel}
              data-testid="cv-switch-template-button"
              className="h-11 w-11 shrink-0"
            >
              <RefreshCw className={cn('h-4 w-4', isSwitchingTemplate && 'animate-spin')} />
            </Button>
          ) : null}
          {showPdfButton ? (
            <ExportButton
              isExporting={isExporting}
              disabled={isExportingAny}
              loadingLabel={t('exportingPdf')}
              onDownload={onDownload!}
              className="flex-1 h-11 gap-2"
              label={t('downloadPdf')}
            />
          ) : null}
          {showDocxButton ? (
            <ExportButton
              isExporting={isExportingDocx}
              disabled={isExportingAny}
              loadingLabel={t('exportingDocx')}
              onDownload={onDownloadDocx!}
              className="flex-1 h-11 gap-2"
              variant={showPdfButton ? 'outline' : 'default'}
              label={t('downloadDocx')}
            />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function ExportButton({
  isExporting,
  disabled,
  loadingLabel,
  onDownload,
  label,
  className,
  variant = 'default',
}: {
  isExporting?: boolean;
  /** Whether the button is clickable — defaults to `isExporting` alone, but the caller may pass a wider guard (e.g. any sibling export in flight). */
  disabled?: boolean;
  loadingLabel: string;
  onDownload: () => void;
  label: string;
  className?: string;
  variant?: 'default' | 'outline';
}) {
  return (
    <Button
      variant={variant}
      disabled={disabled ?? isExporting}
      onClick={onDownload}
      className={className}
    >
      {isExporting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      {isExporting ? loadingLabel : label}
    </Button>
  );
}

function EmptyState({
  message,
  hint,
  action,
}: {
  message: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[480px] flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="h-14 w-11 rounded border-2 border-gray-200 bg-white shadow-sm mb-4" aria-hidden />
      <p className="text-sm text-gray-700">{message}</p>
      {hint ? <p className="text-xs text-gray-500 mt-2 max-w-xs">{hint}</p> : null}
      {action}
    </div>
  );
}
