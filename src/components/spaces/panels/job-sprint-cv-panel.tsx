'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { CvDiffPanel } from '@/components/cv/cv-diff-panel';
import { CvParsedHints } from '@/components/cv/cv-parsed-hints';
import { CvPreviewPane } from '@/components/cv/cv-preview-pane';
import { Button } from '@/components/ui/button';
import { useCvAgent } from '@/hooks/use-cv-agent';
import { cn } from '@/lib/utils';

interface JobSprintCvPanelProps {
  locale: string;
  jobId?: string | null;
  className?: string;
}

/** Template-internal CV workspace panel (surfaces.ts → cv_workspace). */
export function JobSprintCvPanel({ locale, jobId, className }: JobSprintCvPanelProps) {
  const router = useRouter();
  const t = useTranslations('spaces');
  const tCv = useTranslations('cv');

  const {
    preview,
    diff,
    isLoading,
    isSending,
    isUploading,
    needsLogin,
    needsOnboarding,
    needsProfile,
    documentId,
    isExporting,
    exportCvPdf,
    isExportingDocx,
    canExportDocx,
    exportCvDocx,
    confirmCv,
    regenerateCv,
    parsedSections,
    isReadOnly,
  } = useCvAgent(jobId);

  const canDownload = documentId != null;
  const showGate = needsLogin || needsOnboarding || needsProfile === true;

  const previewFooter = (
    <>
      {parsedSections && !isReadOnly ? (
        <CvParsedHints
          sections={parsedSections}
          className="border-t border-gray-200/80 bg-white px-4 py-3"
        />
      ) : null}
      {diff && !isReadOnly ? (
        <CvDiffPanel
          diff={diff}
          onConfirm={() => void confirmCv()}
          onRegenerate={() => void regenerateCv()}
          disabled={isSending || isUploading}
        />
      ) : null}
    </>
  );

  if (showGate) {
    const banner = needsLogin
      ? { text: tCv('loginBanner'), href: `/${locale}/login`, cta: tCv('signIn') }
      : needsOnboarding
        ? { text: tCv('onboardingBanner'), href: `/${locale}/chat`, cta: tCv('completeProfile') }
        : { text: tCv('profileBanner'), href: `/${locale}/profile`, cta: tCv('goToProfile') };

    return (
      <div
        className={cn(
          // KAZI-662: was a bare #ECEEF2 literal — merged into workspace-bg,
          // same rationale as cv-preview-pane.tsx's identical near-neighbor.
          'flex h-full flex-col items-center justify-center gap-3 bg-workspace-bg p-6 text-center',
          className
        )}
      >
        <p className="text-sm text-gray-600">{banner.text}</p>
        <Button size="sm" onClick={() => router.push(banner.href)}>
          {banner.cta}
        </Button>
        <p className="text-xs text-gray-500">{t('cvPanelHint')}</p>
      </div>
    );
  }

  return (
    <CvPreviewPane
      preview={preview}
      isLoading={isLoading && !preview && !canDownload}
      canDownload={canDownload}
      isExporting={isExporting}
      onDownload={() => void exportCvPdf()}
      canDownloadDocx={canDownload && canExportDocx}
      isExportingDocx={isExportingDocx}
      onDownloadDocx={() => void exportCvDocx()}
      footer={previewFooter}
      className={cn('h-full w-full lg:w-full lg:max-w-none', className)}
    />
  );
}
