'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthReady } from '@/hooks/use-auth-ready';
import {
  fetchWorkspaceAssetMarkdownContent,
  fetchWorkspaceAssets,
  reindexWorkspaceAsset,
} from '@/lib/workspace-assets-api';
import { AUTH_SESSION_CLEARED_EVENT } from '@/lib/auth-session-events';
import { getCvDocument } from '@/lib/cv-documents-api';
import { WORKSPACE_ASSET_HUB_SCOPE } from '@/lib/workspace-assets-constants';
import {
  fetchLegacyResumeWorkspaceAssets,
  isLegacyCvWorkspaceAsset,
  legacyCvDocumentId,
} from '@/lib/workspace-assets-legacy-bridge';
import { WORKSPACE_ASSETS_INVALIDATE_EVENT } from '@/lib/workspace-assets-invalidate';
import type {
  FetchWorkspaceAssetsParams,
  WorkspaceAsset,
  WorkspaceAssetCategory,
  WorkspaceAssetCategoryCounts,
  WorkspaceAssetsResponse,
} from '@/types/workspace-asset';

const EMPTY_COUNTS: WorkspaceAssetCategoryCounts = {
  resume: 0,
  english: 0,
  interview: 0,
};

export function workspaceAssetsQueryKey(params?: FetchWorkspaceAssetsParams) {
  return [
    'workspace-assets',
    {
      scope: params?.scope ?? 'user',
      spaceId: params?.spaceId ?? null,
      category: params?.category ?? null,
      includeHistory: params?.includeHistory ?? false,
    },
  ] as const;
}

function normalizeItem(
  raw: unknown,
  includeHistory: boolean
): WorkspaceAsset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const isCurrentRaw = r.is_current ?? r.isCurrent;
  const isCurrent =
    isCurrentRaw === undefined || isCurrentRaw === null
      ? !includeHistory
      : isCurrentRaw !== false && isCurrentRaw !== 'false';

  const assetId = r.asset_id ?? r.assetId;
  if (!assetId) return null;

  return {
    asset_id: String(assetId),
    category: (r.category as WorkspaceAsset['category']) ?? 'resume',
    display_name: String(r.display_name ?? r.displayName ?? 'File'),
    subtitle: (r.subtitle as string | null | undefined) ?? null,
    mime_type:
      (r.mime_type as WorkspaceAsset['mime_type']) ??
      (r.mimeType as WorkspaceAsset['mime_type']) ??
      'text/markdown',
    variant: (r.variant as WorkspaceAsset['variant']) ?? 'source_md',
    indexing_status:
      (r.indexing_status as WorkspaceAsset['indexing_status']) ??
      (r.indexingStatus as WorkspaceAsset['indexing_status']) ??
      'ready',
    preview_url: (r.preview_url ?? r.previewUrl ?? null) as string | null,
    download_url: String(r.download_url ?? r.downloadUrl ?? ''),
    updated_at: String(r.updated_at ?? r.updatedAt ?? ''),
    is_current: isCurrent,
    logical_key: String(r.logical_key ?? r.logicalKey ?? ''),
    provenance: (r.provenance as WorkspaceAsset['provenance']) ?? undefined,
  };
}

function countByCategory(items: WorkspaceAsset[]): WorkspaceAssetCategoryCounts {
  const current = items.filter((item) => item.is_current);
  return {
    resume: current.filter((i) => i.category === 'resume').length,
    english: current.filter((i) => i.category === 'english').length,
    interview: current.filter((i) => i.category === 'interview').length,
  };
}

function pickCategoryCounts(
  derived: WorkspaceAssetCategoryCounts,
  api?: Partial<WorkspaceAssetCategoryCounts>
): WorkspaceAssetCategoryCounts {
  return {
    resume: derived.resume > 0 ? derived.resume : (api?.resume ?? 0),
    english: derived.english > 0 ? derived.english : (api?.english ?? 0),
    interview: derived.interview > 0 ? derived.interview : (api?.interview ?? 0),
  };
}

function countHistoryByCategory(
  items: WorkspaceAsset[]
): WorkspaceAssetCategoryCounts {
  const history = items.filter(
    (item) => !item.is_current && item.indexing_status === 'ready'
  );
  return {
    resume: history.filter((i) => i.category === 'resume').length,
    english: history.filter((i) => i.category === 'english').length,
    interview: history.filter((i) => i.category === 'interview').length,
  };
}

function normalizeResponse(
  data: unknown,
  includeHistory: boolean
): WorkspaceAssetsResponse {
  if (!data || typeof data !== 'object') {
    return { items: [], categories: EMPTY_COUNTS, history_counts: EMPTY_COUNTS };
  }
  const raw = data as Record<string, unknown>;
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((item) => normalizeItem(item, includeHistory))
    .filter((item): item is WorkspaceAsset => item != null);

  const categoriesRaw =
    (raw.categories as WorkspaceAssetCategoryCounts | undefined) ??
    (raw.category_counts as WorkspaceAssetCategoryCounts | undefined);
  const historyRaw =
    (raw.history_counts as WorkspaceAssetCategoryCounts | undefined) ??
    (raw.historyCounts as WorkspaceAssetCategoryCounts | undefined);

  const derivedCategories = countByCategory(items);
  const derivedHistory = countHistoryByCategory(items);

  return {
    items,
    // items-derived wins when non-zero; API counts are fallback only (PR #180 P2)
    categories: pickCategoryCounts(derivedCategories, categoriesRaw),
    history_counts: includeHistory
      ? pickCategoryCounts(derivedHistory, historyRaw)
      : { ...EMPTY_COUNTS, ...historyRaw },
  };
}

function useWorkspaceAssetsQueryLifecycle(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const onInvalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-assets'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-assets-legacy'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-asset-preview'] });
    };
    const onSessionCleared = () => {
      queryClient.removeQueries({ queryKey: ['workspace-assets'] });
      queryClient.removeQueries({ queryKey: ['workspace-assets-legacy'] });
      queryClient.removeQueries({ queryKey: ['workspace-asset-preview'] });
    };

    window.addEventListener(WORKSPACE_ASSETS_INVALIDATE_EVENT, onInvalidate);
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, onSessionCleared);
    return () => {
      window.removeEventListener(WORKSPACE_ASSETS_INVALIDATE_EVENT, onInvalidate);
      window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, onSessionCleared);
    };
  }, [enabled, queryClient]);
}

export function useWorkspaceAssets(
  params?: FetchWorkspaceAssetsParams,
  enabled = true
) {
  const queryClient = useQueryClient();
  const { ready: authReady, authenticated } = useAuthReady();
  const includeHistory = params?.includeHistory ?? false;
  const queryKey = workspaceAssetsQueryKey(params);
  const canFetch = enabled && authReady && authenticated;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetchWorkspaceAssets(params);
      if (!res.success || !res.data) {
        throw new Error(res.error ?? 'Failed to load workspace assets');
      }
      return normalizeResponse(res.data, includeHistory);
    },
    enabled: canFetch,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  useWorkspaceAssetsQueryLifecycle(canFetch);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey]
  );

  const bootstrapping = !authReady || (authenticated && !query.data && !query.error);

  return {
    items: query.data?.items ?? [],
    categories: query.data?.categories ?? EMPTY_COUNTS,
    historyCounts: query.data?.history_counts ?? EMPTY_COUNTS,
    isLoading: bootstrapping || query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
    authReady,
    authenticated,
  };
}

/** Hub category list with legacy cv_documents bridge when workspace-assets is empty. */
export function useWorkspaceHubCategoryAssets(category: WorkspaceAssetCategory) {
  const primary = useWorkspaceAssets(
    { scope: WORKSPACE_ASSET_HUB_SCOPE, category, includeHistory: false },
    true
  );

  const legacyEnabled =
    category === 'resume' &&
    primary.authenticated &&
    !primary.isLoading &&
    !primary.error &&
    primary.items.length === 0;

  const legacyQuery = useQuery({
    queryKey: ['workspace-assets-legacy', category] as const,
    queryFn: fetchLegacyResumeWorkspaceAssets,
    enabled: legacyEnabled,
    staleTime: 30_000,
  });

  const usingLegacy =
    category === 'resume' &&
    primary.items.length === 0 &&
    (legacyQuery.data?.items.length ?? 0) > 0;

  const source: WorkspaceAssetsResponse = usingLegacy
    ? legacyQuery.data!
    : {
        items: primary.items,
        categories: primary.categories,
        history_counts: primary.historyCounts,
      };

  const currentItems = source.items.filter((item) => item.is_current);
  const historyItems = source.items.filter(
    (item) => !item.is_current && item.indexing_status === 'ready'
  );

  const refresh = useCallback(() => {
    void primary.refresh();
    if (category === 'resume') {
      void legacyQuery.refetch();
    }
  }, [category, legacyQuery, primary]);

  return {
    currentItems,
    historyItems,
    categories: source.categories,
    historyCounts: source.history_counts,
    isLoading:
      primary.isLoading || (legacyEnabled && (legacyQuery.isLoading || legacyQuery.isFetching)),
    error: primary.error ?? (legacyQuery.error instanceof Error ? legacyQuery.error.message : null),
    refresh,
    authReady: primary.authReady,
    authenticated: primary.authenticated,
    useStaticHistory: usingLegacy,
  };
}

/** Per-category history fold — fetches only when expanded (P2-2). */
export function useWorkspaceAssetCategoryHistory(
  params: FetchWorkspaceAssetsParams & { category: WorkspaceAsset['category'] },
  expanded: boolean,
  enabled = true
) {
  return useWorkspaceAssets(
    { ...params, includeHistory: true },
    enabled && expanded
  );
}

/** MD preview: detail `content` when present, else signed URL fetch (P1-1). */
export function useWorkspaceAssetPreview(
  asset: WorkspaceAsset | null,
  enabled = true
) {
  return useQuery({
    queryKey: [
      'workspace-asset-preview',
      asset?.asset_id,
      asset?.preview_url ?? asset?.download_url,
    ],
    queryFn: async () => {
      if (!asset) throw new Error('Missing asset');
      if (asset.mime_type !== 'text/markdown') {
        return null;
      }
      if (isLegacyCvWorkspaceAsset(asset)) {
        const docId = legacyCvDocumentId(asset);
        if (!docId) throw new Error('Invalid legacy CV asset');
        const res = await getCvDocument(docId);
        if (!res.success || !res.data?.content_markdown) {
          throw new Error(res.error ?? 'Failed to load CV document');
        }
        return res.data.content_markdown;
      }
      return fetchWorkspaceAssetMarkdownContent(asset);
    },
    enabled:
      enabled &&
      Boolean(asset) &&
      asset?.mime_type === 'text/markdown' &&
      asset.indexing_status === 'ready',
    staleTime: 60_000,
  });
}

export async function retryWorkspaceAssetIndexing(
  asset: WorkspaceAsset
): Promise<{ ok: boolean; error?: string }> {
  const res = await reindexWorkspaceAsset(asset.asset_id);
  if (!res.success) {
    return { ok: false, error: res.error ?? 'Reindex failed' };
  }
  return { ok: true };
}
