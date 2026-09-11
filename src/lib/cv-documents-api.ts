import { apiRequest } from '@/lib/api-client';
import type { ApiResponse } from '@/types';

export interface CvDocumentSummary {
  document_id: number;
  doc_type?: string;
  target_role?: string | null;
  status?: string;
  version?: number;
  preview?: string | null;
  updated_at?: string;
}

export interface CvDocumentDetail extends CvDocumentSummary {
  content_markdown?: string | null;
  created_at?: string;
}

export interface CvDocumentListResponse {
  total?: number;
  items: CvDocumentSummary[];
}

export async function listCvDocuments(): Promise<ApiResponse<CvDocumentListResponse>> {
  return apiRequest<CvDocumentListResponse>('/api/v1/cv/documents');
}

export async function getCvDocument(
  documentId: number
): Promise<ApiResponse<CvDocumentDetail>> {
  return apiRequest<CvDocumentDetail>(
    `/api/v1/cv/documents/${encodeURIComponent(String(documentId))}`
  );
}
