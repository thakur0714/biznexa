import { describe, it, expect } from 'vitest';
import { createMobileApiClient, MobileApiError } from './client';

describe('Mobile API Client', () => {
  it('instantiates typed client with custom baseUrl', () => {
    const client = createMobileApiClient({ baseUrl: 'https://api.biznexa.com' });
    expect(client).toBeDefined();
    expect(typeof client.GET).toBe('function');
    expect(typeof client.POST).toBe('function');
  });

  it('correctly constructs MobileApiError with field errors', () => {
    const error = new MobileApiError(400, 'Validation failed', [
      { field: 'mobile', message: 'Enter a valid 10-digit Indian mobile number' },
      { field: 'email', message: 'Enter a valid email' },
    ]);

    expect(error.status).toBe(400);
    expect(error.message).toBe('Validation failed');
    expect(error.fieldError('mobile')).toBe('Enter a valid 10-digit Indian mobile number');
    expect(error.fieldError('email')).toBe('Enter a valid email');
    expect(error.fieldError('unknown')).toBeUndefined();
  });
});
