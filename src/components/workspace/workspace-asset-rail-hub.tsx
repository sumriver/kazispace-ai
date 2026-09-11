'use client';

import { useState, type ReactNode } from 'react';
import {
  Briefcase,
  ChevronDown,
  FileText,
  LayoutGrid,
  Loader2,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { HUB_ASSET_GRID_CLASS } from '@/components/workspace/workspace-side-rail-hub';
import { useAuthReady } from '@/hooks/use-auth-ready';
import {
  retryWorkspaceAssetIndexing,
  useWorkspaceAssetCategoryHistory,
  useWorkspaceHubCategoryAssets,
} from '@/hooks/use-workspace-assets';
import {
  isWorkspaceAssetReindexEnabled,
  WORKSPACE_ASSET_HUB_SCOPE,
} from '@/lib/workspace-assets-constants';
import { cn } from '@/lib/utils';
import type { WorkspaceAsset, WorkspaceAssetCategory } from '@/types/workspace-asset';

interface WorkspaceAssetRailHubProps {
  locale: string;
  className?: string;
  showCloseButton?: boolean;
  onClose?: () => void;
  onOpenAsset?: (asset: WorkspaceAsset) => void;
  onNavigate?: (path: string) => void;
}

type AssetTone = 'resume' | 'interview' | 'work' | 'spaces' | 'muted';

const TONE_ICON_CLASS: Record<AssetTone, string> = {
  resume: 'bg-sky-50 text-sky-900 ring-sky-200/90',
  interview: 'bg-violet-50 text-violet-900 ring-violet-200/90',
  work: 'bg-workspace-active text-kazi-navy ring-primary/25',
  spaces: 'bg-workspace-hover text-kazi-navy ring-gray-200/90',
  muted: 'bg-gray-50 text-workspace-muted ring-gray-200/80',
};

const CATEGORY_TONE: Record<WorkspaceAssetCategory, AssetTone> = {
  resume: 'resume',
  english: 'resume',
  interview: 'interview',
};

/** v2 hub — file-centric career assets (KAZI-404 resume, KAZI-409 interview). */
export function WorkspaceAssetRailHub({
  locale,
  className,
  showCloseButton = true,
  onClose,
  onOpenAsset,
  onNavigate,
}: WorkspaceAssetRailHubProps) {
  const t = useTranslations('cv.railHub');
  const tV2 = useTranslations('cv.railHub.assetV2');
  const tCv = useTranslations('cv');

  const resumeQuery = useWorkspaceHubCategoryAssets('resume');
  const interviewQuery = useWorkspaceHubCategoryAssets('interview');

  // Auth gate is independent of asset queries (PR #183 review P1).
  const { ready: authReady, authenticated } = useAuthReady();

  const push = (path: string) => onNavigate?.(path);

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col overflow-y-auto text-workspace-text',
        className
      )}
    >
      {showCloseButton && onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-1.5 top-1.5 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-workspace-secondary shadow-sm ring-1 ring-gray-200/80 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={tCv('closeRail')}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

      <ZoneBlock title={t('zoneCareer')} className="pt-2 pr-10">
        <CareerAssetSubcategory
          category="resume"
          label={tV2('categoryResume')}
          count={resumeQuery.categories.resume}
          historyCount={resumeQuery.historyCounts.resume}
          items={resumeQuery.currentItems}
          authReady={authReady}
          authenticated={authenticated}
          isLoading={resumeQuery.isLoading}
          error={resumeQuery.error}
          loginRequiredLabel={tV2('loginRequired')}
          olderAssetsLabel={tV2('olderAssets', { count: resumeQuery.historyCounts.resume })}
          staticHistoryItems={resumeQuery.useStaticHistory ? resumeQuery.historyItems : undefined}
          onOpenAsset={onOpenAsset}
          onRetry={resumeQuery.refresh}
          t={tV2}
        />
        <CareerAssetSubcategory
          category="interview"
          label={tV2('categoryInterview')}
          count={interviewQuery.categories.interview}
          historyCount={interviewQuery.historyCounts.interview}
          items={interviewQuery.currentItems}
          authReady={authReady}
          authenticated={authenticated}
          isLoading={interviewQuery.isLoading}
          error={interviewQuery.error}
          loginRequiredLabel={tV2('loginRequired')}
          olderAssetsLabel={tV2('olderAssets', {
            count: interviewQuery.historyCounts.interview,
          })}
          staticHistoryItems={
            interviewQuery.useStaticHistory ? interviewQuery.historyItems : undefined
          }
          onOpenAsset={onOpenAsset}
          onRetry={interviewQuery.refresh}
          t={tV2}
        />
      </ZoneBlock>

      <ZoneBlock title={t('zoneWork')}>
        <RouteAssetIcon
          icon={Briefcase}
          tone="work"
          label={t('tileJobs')}
          onClick={() => push(`/${locale}/jobs`)}
        />
      </ZoneBlock>

      <ZoneBlock title={t('zoneBusiness')}>
        <RouteAssetIcon
          icon={LayoutGrid}
          tone="spaces"
          label={t('tileSpaces')}
          onClick={() => push(`/${locale}/spaces`)}
        />
        <p className="col-span-full px-1 text-[10px] leading-snug text-workspace-muted">
          {t('zoneBusinessHint')}
        </p>
      </ZoneBlock>
    </div>
  );
}

function ZoneBlock({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b border-gray-100 px-3 py-3', className)}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-workspace-muted">
        {title}
      </h2>
      <div className={HUB_ASSET_GRID_CLASS}>{children}</div>
    </section>
  );
}

function SubcategoryHeader({
  label,
  count,
  historyCount,
}: {
  label: string;
  count: number;
  historyCount: number;
}) {
  return (
    <div className="col-span-full mb-1 flex items-center justify-between gap-2 px-0.5">
      <p className="text-[10px] font-medium text-workspace-secondary">
        {label} · {count}
      </p>
      {historyCount > 0 ? (
        <span className="text-[10px] text-workspace-muted">+{historyCount}</span>
      ) : null}
    </div>
  );
}

/** One career subcategory grid (resume / interview) with history fold. */
function CareerAssetSubcategory({
  category,
  label,
  count,
  historyCount,
  items,
  authReady,
  authenticated,
  isLoading,
  error,
  loginRequiredLabel,
  olderAssetsLabel,
  staticHistoryItems,
  onOpenAsset,
  onRetry,
  t,
}: {
  category: WorkspaceAssetCategory;
  label: string;
  count: number;
  historyCount: number;
  items: WorkspaceAsset[];
  authReady: boolean;
  authenticated: boolean;
  isLoading: boolean;
  error: string | null;
  loginRequiredLabel: string;
  olderAssetsLabel: string;
  staticHistoryItems?: WorkspaceAsset[];
  onOpenAsset?: (asset: WorkspaceAsset) => void;
  onRetry: () => void;
  t: ReturnType<typeof useTranslations<'cv.railHub.assetV2'>>;
}) {
  const tone = CATEGORY_TONE[category];

  return (
    <>
      <SubcategoryHeader label={label} count={count} historyCount={historyCount} />
      {!authReady ? (
        <AssetSkeletonRow />
      ) : !authenticated ? (
        <p className="col-span-full px-1 text-[10px] text-workspace-muted">{loginRequiredLabel}</p>
      ) : isLoading ? (
        <AssetSkeletonRow />
      ) : error ? (
        <p className="col-span-full px-1 text-[10px] text-red-600">{error}</p>
      ) : (
        <>
          {items.map((asset) => (
            <WorkspaceAssetIcon
              key={asset.asset_id}
              asset={asset}
              tone={tone}
              onOpen={() => onOpenAsset?.(asset)}
              onRetry={onRetry}
              t={t}
            />
          ))}
          <CategoryHistoryFold
            category={category}
            label={olderAssetsLabel}
            historyCount={historyCount}
            authenticated={authenticated}
            tone={tone}
            staticHistoryItems={staticHistoryItems}
            onOpenAsset={onOpenAsset}
            onRetry={onRetry}
            t={t}
          />
        </>
      )}
    </>
  );
}

/** Per-category expand + lazy history fetch (SSOT §4.2.2, review P2-2). */
function CategoryHistoryFold({
  category,
  label,
  historyCount,
  authenticated,
  tone,
  staticHistoryItems,
  onOpenAsset,
  onRetry,
  t,
}: {
  category: WorkspaceAssetCategory;
  label: string;
  historyCount: number;
  authenticated: boolean;
  tone: AssetTone;
  staticHistoryItems?: WorkspaceAsset[];
  onOpenAsset?: (asset: WorkspaceAsset) => void;
  onRetry: () => void;
  t: ReturnType<typeof useTranslations<'cv.railHub.assetV2'>>;
}) {
  const [open, setOpen] = useState(false);

  const { items, isLoading } = useWorkspaceAssetCategoryHistory(
    { scope: WORKSPACE_ASSET_HUB_SCOPE, category },
    open && staticHistoryItems == null,
    authenticated
  );

  const historyItems =
    staticHistoryItems ??
    items.filter(
      (item) =>
        item.category === category &&
        !item.is_current &&
        item.indexing_status === 'ready'
    );

  if (historyCount <= 0) return null;

  return (
    <div className="col-span-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded-md px-0.5 py-1 text-left text-[10px] font-medium text-workspace-muted hover:bg-gray-50"
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            open && 'rotate-180'
          )}
          aria-hidden
        />
        {label}
      </button>
      {open ? (
        <div className={cn('mt-1', HUB_ASSET_GRID_CLASS)}>
          {staticHistoryItems == null && isLoading ? (
            <AssetSkeletonRow />
          ) : (
            historyItems.map((asset) => (
              <WorkspaceAssetIcon
                key={asset.asset_id}
                asset={asset}
                tone={tone}
                historical
                onOpen={() => onOpenAsset?.(asset)}
                onRetry={onRetry}
                t={t}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceAssetIcon({
  asset,
  tone,
  historical,
  onOpen,
  onRetry,
  t,
}: {
  asset: WorkspaceAsset;
  tone: AssetTone;
  historical?: boolean;
  onOpen: () => void;
  onRetry: () => void;
  t: ReturnType<typeof useTranslations<'cv.railHub.assetV2'>>;
}) {
  const [retrying, setRetrying] = useState(false);
  const reindexEnabled = isWorkspaceAssetReindexEnabled();
  const isPending = asset.indexing_status === 'pending';
  const isFailed = asset.indexing_status === 'failed';
  const mimeLabel = asset.mime_type === 'application/pdf' ? 'PDF' : 'MD';

  const handleClick = async () => {
    if (isFailed) {
      if (!reindexEnabled) return;
      setRetrying(true);
      await retryWorkspaceAssetIndexing(asset);
      setRetrying(false);
      onRetry();
      return;
    }
    if (isPending) return;
    onOpen();
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isPending || retrying || (isFailed && !reindexEnabled)}
      title={asset.display_name}
      className={cn(
        'relative flex min-w-0 flex-col items-center gap-0.5 rounded-lg p-1',
        'hover:bg-gray-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        (isPending || isFailed) && 'opacity-80'
      )}
    >
      <span
        className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
          isFailed ? TONE_ICON_CLASS.muted : TONE_ICON_CLASS[tone]
        )}
      >
        {isPending || retrying ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : isFailed ? (
          <RefreshCw className="h-4 w-4" aria-hidden />
        ) : (
          <FileText className="h-4 w-4" aria-hidden />
        )}
        <span className="absolute -bottom-0.5 -right-0.5 rounded bg-white px-0.5 text-[8px] font-semibold leading-none text-workspace-secondary ring-1 ring-gray-200">
          {mimeLabel}
        </span>
        {historical ? (
          <span className="absolute -left-0.5 -top-0.5 rounded bg-workspace-muted px-0.5 text-[7px] font-medium leading-none text-white">
            {t('historyBadge')}
          </span>
        ) : null}
      </span>
      <span className="line-clamp-2 w-full text-center text-[10px] leading-tight text-workspace-secondary">
        {isFailed
          ? reindexEnabled
            ? t('indexFailed')
            : t('indexFailedNoRetry')
          : asset.display_name}
      </span>
      {asset.subtitle ? (
        <span className="line-clamp-1 w-full text-center text-[9px] leading-tight text-workspace-muted">
          {asset.subtitle}
        </span>
      ) : null}
    </button>
  );
}

function RouteAssetIcon({
  icon: Icon,
  tone,
  label,
  onClick,
}: {
  icon: LucideIcon;
  tone: AssetTone;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex min-w-0 flex-col items-center gap-0.5 rounded-lg p-1',
        'hover:bg-gray-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
          TONE_ICON_CLASS[tone]
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="line-clamp-2 w-full text-center text-[10px] leading-tight text-workspace-secondary">
        {label}
      </span>
    </button>
  );
}

function AssetSkeletonRow() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-1 p-1">
          <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-2 w-10 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </>
  );
}
