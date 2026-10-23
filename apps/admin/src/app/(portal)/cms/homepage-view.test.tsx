import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomepageCmsView } from './homepage-view';

const { call, apiMock, auth } = vi.hoisted(() => {
  const call = vi.fn();
  return { call, apiMock: { call }, auth: { permissions: ['cms.manage'] } };
});
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => apiMock }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: auth }) }));
vi.mock('@biznexa/ui', async () => {
  const actual = await vi.importActual<typeof import('@biznexa/ui')>('@biznexa/ui');
  return { ...actual, useToast: () => () => undefined };
});
vi.mock('@/components/rich-text-editor', () => ({ RichTextEditor: ({ label }: { label: string }) => <div>{label} editor</div> }));
vi.mock('@/components/portal-shell', () => ({ NotAllowed: () => <p>Not allowed</p> }));

const home = {
  banners: [
    { id: 'b1', title: 'Festive offer', subtitle: null, imageUrl: null, linkUrl: '/services', placement: 'home', sortOrder: 0, isActive: true },
    { id: 'b2', title: 'Talk to a CA', subtitle: null, imageUrl: null, linkUrl: null, placement: 'home', sortOrder: 1, isActive: true },
  ],
  testimonials: [],
  stats: [{ label: 'Services', value: '80+', sortOrder: 0, isActive: true }],
  popularServiceIds: ['s1'],
  faq: [],
};
const services = Array.from({ length: 10 }, (_, i) => ({ id: `s${i + 1}`, name: `Service ${i + 1}` }));

/** The body of the last PUT the view sent. */
async function sent() {
  const run = call.mock.calls.at(-1)![0] as (c: { PUT: (path: string, init: { body: unknown }) => unknown }) => unknown;
  let body: unknown;
  run({ PUT: (_path, init) => { body = init.body; return {}; } });
  return body as typeof home;
}

describe('HomepageCmsView', () => {
  beforeEach(() => {
    call.mockReset();
    auth.permissions = ['cms.manage'];
    call.mockResolvedValueOnce(structuredClone(home)).mockResolvedValueOnce(services);
  });

  it('loads the content and saves edits, a new counter, a reorder and a switched-off banner', async () => {
    render(<HomepageCmsView />);
    expect(await screen.findByDisplayValue('Festive offer')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Title', { selector: '#banner-title-0' }), { target: { value: 'Diwali offer' } });
    const second = screen.getByRole('group', { name: 'Banner 2' });
    fireEvent.click(within(second).getByRole('button', { name: 'Move up' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Banner 2' })).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Add counter' }));
    fireEvent.change(screen.getByLabelText('Label', { selector: '#stat-label-1' }), { target: { value: 'Customers' } });
    fireEvent.change(screen.getByLabelText('Value', { selector: '#stat-value-1' }), { target: { value: '5,000+' } });

    call.mockResolvedValueOnce(structuredClone(home));
    fireEvent.click(screen.getByRole('button', { name: 'Save homepage' }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(3));

    const body = await sent();
    expect(body.banners.map((b) => [b.title, b.sortOrder, b.isActive])).toEqual([['Talk to a CA', 0, true], ['Diwali offer', 1, false]]);
    expect(body.stats).toEqual([home.stats[0], { label: 'Customers', value: '5,000+', sortOrder: 1, isActive: true }]);
    expect(body.popularServiceIds).toEqual(['s1']);
  });

  it('lets the admin pick at most eight popular services', async () => {
    render(<HomepageCmsView />);
    await screen.findByDisplayValue('Festive offer');
    for (let i = 2; i <= 8; i++) fireEvent.click(screen.getByLabelText(`Service ${i}`));
    expect((screen.getByLabelText('Service 9') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Service 1'));
    expect((screen.getByLabelText('Service 9') as HTMLInputElement).disabled).toBe(false);
  });

  it('shows the API’s reason when saving fails and keeps the edits', async () => {
    render(<HomepageCmsView />);
    await screen.findByDisplayValue('Festive offer');
    fireEvent.change(screen.getByLabelText('Title', { selector: '#banner-title-0' }), { target: { value: 'Unsaved title' } });
    call.mockRejectedValueOnce(new Error('Choose an image uploaded to the public media library'));
    fireEvent.click(screen.getByRole('button', { name: 'Save homepage' }));
    expect(await screen.findByText('Choose an image uploaded to the public media library')).toBeTruthy();
    expect(screen.getByDisplayValue('Unsaved title')).toBeTruthy();
  });

  it('is closed to staff without cms.manage', async () => {
    auth.permissions = ['applications.view_assigned'];
    render(<HomepageCmsView />);
    expect(await screen.findByText('Not allowed')).toBeTruthy();
    await act(async () => {}); // the load the view starts before its permission check settles
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save homepage' })).toBeNull();
  });
});
