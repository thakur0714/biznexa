import { describe, expect, it } from 'vitest';
import { pendingActionsResponseSchema } from './pending-actions';

describe('pendingActionsResponseSchema', () => {
  it('parses the customer pending action response', () => {
    expect(pendingActionsResponseSchema.parse({
      items: [{
        kind: 'reupload_document',
        applicationId: '00000000-0000-4000-8000-000000000001',
        applicationCode: 'BN10001',
        serviceName: 'Company Registration',
        title: 'Re-upload PAN card',
        href: '/dashboard/applications/00000000-0000-4000-8000-000000000001?tab=documents',
      }],
    }).items).toHaveLength(1);
  });
});
