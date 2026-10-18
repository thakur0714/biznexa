import type { StoredFileResult } from '@biznexa/types';
import { resolveApiUrl } from './client';

export interface MobileUploadOptions {
  uri: string;
  name: string;
  mimeType: string;
  requirementId?: string;
  token?: string | null;
  baseUrl?: string;
}

/**
 * Upload a file from React Native via multipart/form-data to POST /api/files.
 */
export async function uploadMobileFile(options: MobileUploadOptions): Promise<StoredFileResult> {
  const formData = new FormData();
  formData.append('file', {
    uri: options.uri,
    name: options.name,
    type: options.mimeType,
  } as unknown as Blob);

  const query = options.requirementId
    ? `?requirementId=${encodeURIComponent(options.requirementId)}`
    : '';
  const url = resolveApiUrl(`/api/files${query}`, options.baseUrl);

  const headers: Record<string, string> = {
    'x-client': 'mobile',
  };
  if (options.token) {
    headers['authorization'] = `Bearer ${options.token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    const msg = errorBody?.message || `File upload failed with status ${response.status}`;
    throw new Error(msg);
  }

  return (await response.json()) as StoredFileResult;
}
