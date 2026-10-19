import { storedFileSchema, type StoredFileResult } from '@biznexa/types';
import { resolveApiUrl } from './client';

interface ReactNativeUploadFile { uri: string; name: string; type: string }

declare global {
  interface FormData {
    append(name: string, value: ReactNativeUploadFile): void;
  }
}

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
  const file = {
    uri: options.uri,
    name: options.name,
    type: options.mimeType,
  };
  formData.append('file', file);

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Upload timed out. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => null);
    const message = errorBody && typeof errorBody === 'object' && 'message' in errorBody && typeof errorBody.message === 'string' ? errorBody.message : null;
    const msg = message || `File upload failed with status ${response.status}`;
    throw new Error(msg);
  }

  return storedFileSchema.parse(await response.json());
}
