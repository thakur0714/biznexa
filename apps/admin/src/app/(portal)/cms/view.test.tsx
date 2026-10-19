import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CmsView } from './view';

const { call, apiMock } = vi.hoisted(() => {
  const call = vi.fn();
  return { call, apiMock: { call } };
});
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => apiMock }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { permissions: ['cms.manage'] } }) }));
vi.mock('@biznexa/ui', async () => {
  const actual = await vi.importActual<typeof import('@biznexa/ui')>('@biznexa/ui');
  return { ...actual, useToast: () => () => undefined };
});
vi.mock('@/components/rich-text-editor', () => ({ RichTextEditor: () => <div>Rich text editor</div> }));

describe('CmsView draft editing', () => {
  beforeEach(() => {
    call.mockReset();
    call.mockResolvedValueOnce([{
      id: 'page-1', slug: 'about', title: 'Published title', content: { html: '<p>Published copy</p>' }, seoTitle: null,
      metaDescription: null, ogImageUrl: null, contactEmail: null, contactPhone: null, status: 'PUBLISHED', updatedAt: '2026-10-19T10:00:00.000Z',
      draftTitle: 'Draft title', draftContent: { html: '<p>Draft copy</p>' }, draftSeoTitle: null, draftMetaDescription: null,
      draftOgImageUrl: null, draftContactEmail: null, draftContactPhone: null,
    }]);
  });

  it('shows unpublished changes with a preview, publish and discard actions', async () => {
    render(<CmsView />);
    expect(await screen.findByRole('region', { name: 'Unpublished changes' })).toBeTruthy();
    expect(screen.getByText('Visitors still see the published version.')).toBeTruthy();
    fireEvent.click(screen.getByText('Preview draft'));
    expect(screen.getByText('Draft copy')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeTruthy();
  });
});
