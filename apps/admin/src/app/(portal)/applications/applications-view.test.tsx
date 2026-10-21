
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApplicationsView } from './applications-view';
import * as auth from '@/lib/auth';

vi.mock('@/lib/auth');

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => ({ 
    call: vi.fn().mockImplementation(() => {
      // Mock the GET calls based on url inside callback string if possible,
      // but cb is a function. So we can't easily parse it.
      // Let's just return an array if we are resolving staff?
      // Actually, we can return an array ALWAYS. Wait, the main data is an object.
      // Let's just mock `call` to return what's expected by returning a proxy or just an object with array methods.
      // No, let's just make it return an array for staff. We can spy on the mock and return different values.
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 25, map: () => [] });
    })
  })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('ApplicationsView Assignment UI (M4.5)', () => {
  it('shows the assignee picker only if the user has view_all and update permissions', () => {
    vi.spyOn(auth, 'useAuth').mockReturnValue({ 
      user: { id: 'u1', name: 'Ops', email: 'ops@test.com', permissions: ['applications.view_all', 'applications.update'] } 
    } as unknown as ReturnType<typeof auth.useAuth>);

    render(<ApplicationsView />);
    expect(screen.getByRole('button', { name: 'Assign Selected' })).not.toBeNull();
  });

  it('hides the assignee picker if the user is missing update permission', () => {
    vi.spyOn(auth, 'useAuth').mockReturnValue({ 
      user: { id: 'u1', name: 'Ops', email: 'ops@test.com', permissions: ['applications.view_all'] } 
    } as unknown as ReturnType<typeof auth.useAuth>);

    render(<ApplicationsView />);
    expect(screen.queryByRole('button', { name: 'Assign Selected' })).toBeNull();
  });

  it('hides the assignee picker if the user is missing view_all permission', () => {
    vi.spyOn(auth, 'useAuth').mockReturnValue({ 
      user: { id: 'u1', name: 'Ops', email: 'ops@test.com', permissions: ['applications.view_assigned', 'applications.update'] } 
    } as unknown as ReturnType<typeof auth.useAuth>);

    render(<ApplicationsView />);
    expect(screen.queryByRole('button', { name: 'Assign Selected' })).toBeNull();
  });
});
