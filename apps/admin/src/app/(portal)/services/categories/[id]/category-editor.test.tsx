import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, type AdminCategoryDetail } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { CategoryEditorView } from './category-editor';

const { call, apiMock, auth, toast } = vi.hoisted(() => {
  const call = vi.fn();
  return { call, apiMock: { call }, auth: { permissions: [] as string[] }, toast: vi.fn() };
});
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => apiMock }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: auth }) }));
vi.mock('@biznexa/ui', async () => {
  const actual = await vi.importActual<typeof import('@biznexa/ui')>('@biznexa/ui');
  return { ...actual, useToast: () => toast };
});
vi.mock('@/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (html: string) => void; error?: string }) => (
    <div>
      <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <p>{error}</p>}
    </div>
  ),
}));
vi.mock('@/components/portal-shell', () => ({ NotAllowed: () => <p>Not allowed</p> }));

const ID = '11111111-1111-4111-8111-111111111111';
const category: AdminCategoryDetail = {
  id: ID,
  slug: 'licences',
  name: 'Licences',
  tagline: 'Every licence your business needs',
  description: null,
  icon: null,
  journeyStage: 'START',
  sortOrder: 0,
  isActive: true,
  seoTitle: 'Business licences online',
  metaDescription: null,
  seoContent: '<p>Intro</p>',
  faqs: [
    { question: 'How long does it take?', answer: '<p>About a week.</p>', sortOrder: 0 },
    { question: 'Which documents are needed?', answer: '<p>PAN and address proof.</p>', sortOrder: 1 },
  ],
};

/** The path and body of the last PATCH the editor sent. */
function sent() {
  const run = call.mock.calls.at(-1)![0] as (c: { PATCH: (path: string, init: { params: unknown; body: unknown }) => unknown }) => unknown;
  let request: { path: string; params: unknown; body: unknown } | undefined;
  run({ PATCH: (path, init) => { request = { path, ...init }; return {}; } });
  return request!;
}

describe('CategoryEditorView', () => {
  beforeEach(() => {
    call.mockReset();
    toast.mockReset();
    auth.permissions = [PERMS.SERVICES_MANAGE];
    call.mockResolvedValueOnce(structuredClone(category));
  });

  it('loads the category and saves edits, a new FAQ and a reorder', async () => {
    render(<CategoryEditorView id={ID} />);
    expect(await screen.findByDisplayValue('Licences')).toBeTruthy();
    expect(screen.getByText('24 / 60 characters')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tagline'), { target: { value: 'Licences, done for you' } });
    fireEvent.change(screen.getByLabelText('Meta description'), { target: { value: 'Apply for any licence online.' } });
    fireEvent.change(screen.getByLabelText('Page content'), { target: { value: '<p>New intro</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move question 2 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    fireEvent.change(screen.getByLabelText('Question', { selector: '#cat-faq-2-q' }), { target: { value: 'Can I apply online?' } });
    fireEvent.change(screen.getByLabelText('Answer', { selector: '#cat-faq-2-a' }), { target: { value: '<p>Yes.</p>' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    call.mockResolvedValueOnce(structuredClone(category));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Changes saved.', 'success'));

    const { path, params, body } = sent();
    expect(path).toBe('/api/admin/catalogue/categories/{id}');
    expect(params).toEqual({ path: { id: ID } });
    expect(body).toEqual({
      name: 'Licences',
      tagline: 'Licences, done for you',
      description: '',
      seoTitle: 'Business licences online',
      metaDescription: 'Apply for any licence online.',
      seoContent: '<p>New intro</p>',
      faqs: [
        { question: 'Which documents are needed?', answer: '<p>PAN and address proof.</p>', sortOrder: 0 },
        { question: 'How long does it take?', answer: '<p>About a week.</p>', sortOrder: 1 },
        { question: 'Can I apply online?', answer: '<p>Yes.</p>', sortOrder: 2 },
      ],
    });
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('removes a FAQ and clears blank page content', async () => {
    render(<CategoryEditorView id={ID} />);
    await screen.findByDisplayValue('Licences');
    fireEvent.click(screen.getByRole('button', { name: 'Remove question 1' }));
    fireEvent.change(screen.getByLabelText('Page content'), { target: { value: '' } });

    call.mockResolvedValueOnce(structuredClone(category));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));

    const body = sent().body as { seoContent: unknown; faqs: unknown[] };
    expect(body.seoContent).toBeNull();
    expect(body.faqs).toEqual([{ question: 'Which documents are needed?', answer: '<p>PAN and address proof.</p>', sortOrder: 0 }]);
  });

  it('shows the API’s field errors on the fields and keeps the edits', async () => {
    render(<CategoryEditorView id={ID} />);
    await screen.findByDisplayValue('Licences');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'L' } });
    fireEvent.change(screen.getByLabelText('Question', { selector: '#cat-faq-0-q' }), { target: { value: 'Why' } });

    call.mockRejectedValueOnce(
      new ClientApiError(400, 'Please check the highlighted fields', [
        { field: 'name', message: 'String must contain at least 2 character(s)' },
        { field: 'faqs.0.question', message: 'Write the question (at least 5 characters)' },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Please check the highlighted fields')).toBeTruthy();
    expect(screen.getByText('String must contain at least 2 character(s)')).toBeTruthy();
    expect(screen.getByText('Write the question (at least 5 characters)')).toBeTruthy();
    expect(screen.getByDisplayValue('L')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(toast).not.toHaveBeenCalled();
  });

  it('is closed to staff without services.manage', async () => {
    auth.permissions = [PERMS.ADMIN_ACCESS];
    render(<CategoryEditorView id={ID} />);
    expect(await screen.findByText('Not allowed')).toBeTruthy();
    await act(async () => {});
    expect(call).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});
