import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '@biznexa/api-client/react';
import { ToastProvider } from '@biznexa/ui';
import { AnnouncementsView } from './announcements-view';

const refresh = vi.fn(async () => 'token');
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 201, headers: { 'content-type': 'application/json' } });
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname.endsWith('/count')) return json({ recipients: 7 });
  if (url.pathname.endsWith('/announcements')) return json({ sourceKey: '11111111-1111-4111-8111-111111111111', recipients: 7, queued: 7 });
  if (url.pathname.endsWith('/categories')) return json([
    {
      id: 'cat-123', slug: 'cat-one', name: 'Category One', isActive: true, sortOrder: 1, services: 2, activeServices: 2, subcategories: []
    },
    {
      id: 'cat-456', slug: 'cat-two', name: 'Category Two', isActive: true, sortOrder: 2, services: 0, activeServices: 0, subcategories: []
    }
  ]);
  return json({ message: 'not found' });
})));

describe('AnnouncementsView', () => {
  it('shows a recipient count before allowing a queue send', async () => {
    render(<ApiProvider token="token" refresh={refresh}><ToastProvider><AnnouncementsView /></ToastProvider></ApiProvider>);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Service update' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please review your account.' } });
    expect(screen.getByRole('button', { name: 'Queue announcement' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show recipient count' }));
    await screen.findByRole('status');
    expect(screen.getByRole('status')).toHaveTextContent('7 recipients');
    fireEvent.click(screen.getByRole('button', { name: 'Queue announcement' }));
    await waitFor(() => expect(screen.getByText(/queued for 7 customers/i)).toBeInTheDocument());
  });

  it('allows selecting a category for active application segment and fetching count', async () => {
    render(<ApiProvider token="token" refresh={refresh}><ToastProvider><AnnouncementsView /></ToastProvider></ApiProvider>);

    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'ACTIVE_APPLICATION_CATEGORY' } });

    // Wait for categories to load
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Category' })).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show recipient count' }));
    await screen.findByRole('status');
    expect(screen.getByRole('status')).toHaveTextContent('7 recipients');
  });
});
