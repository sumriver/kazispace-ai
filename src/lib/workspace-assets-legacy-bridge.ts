import { listCvDocuments } from '@/lib/cv-documents-api';
import type { WorkspaceAsset, WorkspaceAssetsResponse } from '@/types/workspace-asset';

export const LEGACY_CV_ASSET_PREFIX = 'legacy_cv_';

export function isLegacyCvWorkspaceAsset(asset: WorkspaceAsset): boolean {
  return asset.asset_id.startsWith(LEGACY_CV_ASSET_PREFIX);
}

export function legacyCvDocumentId(asset: WorkspaceAsset): number | null {
  if (!isLegacyCvWorkspaceAsset(asset)) return null;
  const id = Number(asset.asset_id.slice(LEGACY_CV_ASSET_PREFIX.length));
  return Number.isFinite(id) ? id : null;
}

function mapCvDocumentToAsset(
  doc: {
    document_id: number;
    target_role?: string | null;
    updated_at?: string;
  },
  isCurrent: boolean
): WorkspaceAsset {
  const role = doc.target_role?.trim();
  return {
    asset_id: `${LEGACY_CV_ASSET_PREFIX}${doc.document_id}`,
    category: 'resume',
    display_name: role ? `简历 · ${role}` : '简历.md',
    subtitle: role ?? null,
    mime_type: 'text/markdown',
    variant: 'source_md',
    indexing_status: 'ready',
    preview_url: null,
    download_url: '',
    updated_at: doc.updated_at ?? '',
    is_current: isCurrent,
    logical_key: `resume:legacy_cv_${doc.document_id}`,
    provenance: { agent_id: 'cv_builder' },
  };
}

/**
 * Bridge until BE WorkspaceAssetAssembler backfills legacy cv_documents.
 * Only used when GET /workspace-assets returns empty for resume.
 */
export async function fetchLegacyResumeWorkspaceAssets(): Promise<WorkspaceAssetsResponse> {
  const res = await listCvDocuments();
  if (!res.success || !res.data?.items?.length) {
    return { items: [], categories: { resume: 0, english: 0, interview: 0 }, history_counts: { resume: 0, english: 0, interview: 0 } };
  }

  const sorted = [...res.data.items].sort((a, b) => {
    const ta = Date.parse(a.updated_at ?? '') || 0;
    const tb = Date.parse(b.updated_at ?? '') || 0;
    return tb - ta;
  });

  const items = sorted.map((doc, index) => mapCvDocumentToAsset(doc, index === 0));
  const current = items.filter((item) => item.is_current).length;
  const history = items.length - current;

  return {
    items,
    categories: { resume: current, english: 0, interview: 0 },
    history_counts: { resume: history, english: 0, interview: 0 },
  };
}
