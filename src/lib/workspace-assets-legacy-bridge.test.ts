import { describe, expect, it } from 'vitest';

import {
  LEGACY_CV_ASSET_PREFIX,
  isLegacyCvWorkspaceAsset,
  legacyCvDocumentId,
} from '@/lib/workspace-assets-legacy-bridge';

describe('workspace-assets-legacy-bridge', () => {
  it('detects legacy cv asset ids', () => {
    const asset = {
      asset_id: `${LEGACY_CV_ASSET_PREFIX}10`,
      category: 'resume' as const,
      display_name: '简历.md',
      mime_type: 'text/markdown' as const,
      variant: 'source_md' as const,
      indexing_status: 'ready' as const,
      download_url: '',
      updated_at: '',
      is_current: true,
      logical_key: 'resume:legacy_cv_10',
    };
    expect(isLegacyCvWorkspaceAsset(asset)).toBe(true);
    expect(legacyCvDocumentId(asset)).toBe(10);
  });
});
