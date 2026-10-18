import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadMobileFile } from './upload';
import { resolveApiUrl, DEFAULT_BASE_URL } from './client';

describe('resolveApiUrl', () => {
  it('resolves relative URLs against default or custom base URL', () => {
    expect(resolveApiUrl('/api/invoices/123/link', 'https://api.biznexa.com')).toBe(
      'https://api.biznexa.com/api/invoices/123/link'
    );
    expect(resolveApiUrl('api/files/download', 'https://api.biznexa.com/')).toBe(
      'https://api.biznexa.com/api/files/download'
    );
  });

  it('preserves absolute URLs', () => {
    expect(resolveApiUrl('https://storage.googleapis.com/bucket/file.pdf')).toBe(
      'https://storage.googleapis.com/bucket/file.pdf'
    );
  });
});

describe('uploadMobileFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends multipart form-data to /api/files with mobile headers', async () => {
    const mockFileResult = {
      id: '11111111-1111-1111-1111-111111111111',
      fileName: 'pan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      sha256: 'abc',
      requirementId: '22222222-2222-2222-2222-222222222222',
      scanStatus: 'CLEAN' as const,
      createdAt: new Date().toISOString(),
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockFileResult,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadMobileFile({
      uri: 'file:///data/cache/pan.pdf',
      name: 'pan.pdf',
      mimeType: 'application/pdf',
      requirementId: '22222222-2222-2222-2222-222222222222',
      token: 'jwt-token-123',
      baseUrl: 'https://api.biznexa.com',
    });

    expect(result).toEqual(mockFileResult);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'https://api.biznexa.com/api/files?requirementId=22222222-2222-2222-2222-222222222222'
    );
    expect(calledOptions.method).toBe('POST');
    expect(calledOptions.headers['authorization']).toBe('Bearer jwt-token-123');
    expect(calledOptions.headers['x-client']).toBe('mobile');
  });

  it('throws descriptive error on API failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'File rejected: not a valid PDF' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadMobileFile({
        uri: 'file:///data/cache/bad.txt',
        name: 'bad.txt',
        mimeType: 'text/plain',
      })
    ).rejects.toThrow('File rejected: not a valid PDF');
  });
});
