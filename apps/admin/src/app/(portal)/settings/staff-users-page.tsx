'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PERMS, type AdminStaffListResponse, type AdminStaffRow } from '@biznexa/types';
import { Button, Field, Notice, useToast } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useAuth } from '@/lib/auth';
import { NotAllowed } from '@/components/portal-shell';

type RoleOption = { key: string; name: string };
type Dialog = { kind: 'add' } | { kind: 'roles'; user: AdminStaffRow } | { kind: 'confirm'; action: 'deactivate' | 'reactivate' | 'reset'; user: AdminStaffRow } | null;

export function StaffUsersPage() {
  const api = useApi();
  const toast = useToast();
  const { user: actor } = useAuth();
  const allowed = !!actor?.permissions.includes(PERMS.USERS_MANAGE);
  const [result, setResult] = useState<AdminStaffListResponse | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const limit = 20;

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    Promise.all([
      api.call<AdminStaffListResponse>((c) => c.GET('/api/admin/staff-users', { params: { query: { page, limit, ...(query.trim() ? { q: query.trim() } : {}) } } })),
      api.call<RoleOption[]>((c) => c.GET('/api/admin/staff-users/roles')),
    ]).then(([list, roleOptions]) => { if (!cancelled) { setResult(list); setRoles(roleOptions); setError(null); } }, (err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [api, allowed, page, query, refresh]);

  if (actor && !allowed) return <NotAllowed />;

  async function save(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try { await action(); setDialog(null); toast(message, 'success'); setRefresh((n) => n + 1); }
    catch (err) { setError(err instanceof ClientApiError ? err.message : (err as Error).message); }
    finally { setBusy(false); }
  }

  const maxPage = Math.max(1, Math.ceil((result?.total ?? 0) / limit));
  return (
    <section className="max-w-[1200px] border-t border-rule pt-8" aria-labelledby="staff-users-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="staff-users-title" className="text-xl font-bold text-night">Staff users</h2><p className="mt-1 text-sm text-muted">Manage staff access and two-factor recovery.</p></div>
        <Button variant="ink" size="sm" onClick={() => setDialog({ kind: 'add' })}>Add staff</Button>
      </div>
      <div className="mt-5 max-w-md"><Field id="staff-search" label="Search staff" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Name, email or mobile" /></div>
      {error && <div className="mt-4"><Notice tone="error">{error}</Notice><Button className="mt-2" variant="outline" size="sm" onClick={() => setRefresh((n) => n + 1)}>Try again</Button></div>}
      {!result && !error ? <p className="mt-5 text-sm text-muted" role="status">Loading staff users…</p> : result?.items.length === 0 ? <p className="mt-5 rounded-md border border-rule bg-white p-5 text-sm text-muted">No staff users found.</p> : result && <>
        <div className="mt-5 hidden overflow-x-auto rounded-md border border-rule bg-white md:block">
          <table className="w-full text-left text-sm"><thead className="bg-surface text-xs text-muted"><tr>{['Name', 'Email', 'Mobile', 'Roles', 'Status', '2FA', 'Last login', 'Actions'].map((heading) => <th key={heading} scope="col" className="px-3 py-3 font-semibold">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-rule">{result.items.map((staff) => <tr key={staff.id}>
              <td className="px-3 py-3 font-medium">{staff.name}</td><td className="px-3 py-3 break-all">{staff.email || '—'}</td><td className="px-3 py-3 whitespace-nowrap">{staff.mobile || '—'}</td><td className="px-3 py-3">{staff.roles.map((r) => r.name).join(', ')}</td><td className="px-3 py-3">{staff.active ? 'Active' : 'Inactive'}</td><td className="px-3 py-3">{staff.twoFactorEnabled ? 'On' : 'Off'}</td><td className="px-3 py-3 whitespace-nowrap">{staff.lastLoginAt ? new Date(staff.lastLoginAt).toLocaleString() : 'Never'}</td><td className="px-3 py-3"><Actions staff={staff} setDialog={setDialog} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3 md:hidden">{result.items.map((staff) => <article key={staff.id} className="min-w-0 rounded-md border border-rule bg-white p-4">
          <div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-semibold">{staff.name}</h3><p className="break-all text-sm text-muted">{staff.email || '—'}</p><p className="text-sm text-muted">{staff.mobile || '—'}</p></div><span className="shrink-0 rounded-full bg-surface px-2 py-1 text-xs">{staff.active ? 'Active' : 'Inactive'}</span></div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-muted">Roles</dt><dd className="break-words">{staff.roles.map((r) => r.name).join(', ')}</dd></div><div><dt className="text-xs text-muted">2FA</dt><dd>{staff.twoFactorEnabled ? 'On' : 'Off'}</dd></div><div className="col-span-2"><dt className="text-xs text-muted">Last login</dt><dd>{staff.lastLoginAt ? new Date(staff.lastLoginAt).toLocaleString() : 'Never'}</dd></div></dl>
          <div className="mt-3"><Actions staff={staff} setDialog={setDialog} /></div>
        </article>)}</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted">{result.total} staff · Page {page} of {maxPage}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= maxPage} onClick={() => setPage((n) => n + 1)}>Next</Button></div></div>
      </>}
      {dialog?.kind === 'add' && <AddDialog roles={roles} busy={busy} onClose={() => setDialog(null)} onSubmit={(body) => save(() => api.call((c) => c.POST('/api/admin/staff-users', { body })), 'Staff user created')} />}
      {dialog?.kind === 'roles' && <RolesDialog user={dialog.user} roles={roles} busy={busy} onClose={() => setDialog(null)} onSubmit={(next) => save(() => api.call((c) => c.PATCH('/api/admin/staff-users/{id}/roles', { params: { path: { id: dialog.user.id } }, body: { roles: next } })), 'Roles updated')} />}
      {dialog?.kind === 'confirm' && <ConfirmDialog dialog={dialog} busy={busy} onClose={() => setDialog(null)} onConfirm={() => {
        const d = dialog;
        if (d.action === 'reset') return save(() => api.call((c) => c.POST('/api/admin/staff-users/{id}/reset-2fa', { params: { path: { id: d.user.id } } })), '2FA reset; all sessions signed out');
        return save(() => api.call((c) => c.PATCH('/api/admin/staff-users/{id}/status', { params: { path: { id: d.user.id } }, body: { active: d.action === 'reactivate' } })), d.action === 'deactivate' ? 'Staff user deactivated' : 'Staff user reactivated');
      }} />}
    </section>
  );
}

function Actions({ staff, setDialog }: { staff: AdminStaffRow; setDialog: (value: Dialog) => void }) {
  return <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'roles', user: staff })}>Edit roles</Button><Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'confirm', action: staff.active ? 'deactivate' : 'reactivate', user: staff })}>{staff.active ? 'Deactivate' : 'Reactivate'}</Button><Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'confirm', action: 'reset', user: staff })}>Reset 2FA</Button></div>;
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="staff-dialog-title" className="max-h-[90dvh] w-full overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-xl"><div className="flex items-start justify-between gap-4"><h3 id="staff-dialog-title" className="text-lg font-bold">{title}</h3><button type="button" aria-label="Close dialog" onClick={onClose} className="rounded p-1 text-lg leading-none hover:bg-surface focus-visible:outline-2">×</button></div>{children}</section></div>;
}

function RoleChecks({ roles, selected, setSelected }: { roles: RoleOption[]; selected: string[]; setSelected: (keys: string[]) => void }) {
  return <fieldset className="mt-4"><legend className="text-sm font-semibold">Roles</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{roles.map((role) => <label key={role.key} className="flex min-h-11 items-center gap-2 rounded border border-rule px-3 py-2 text-sm"><input type="checkbox" checked={selected.includes(role.key)} onChange={(e) => setSelected(e.target.checked ? [...selected, role.key] : selected.filter((key) => key !== role.key))} />{role.name}</label>)}</div></fieldset>;
}

function AddDialog({ roles, busy, onClose, onSubmit }: { roles: RoleOption[]; busy: boolean; onClose: () => void; onSubmit: (body: { name: string; email: string; mobile: string; roles: string[]; temporaryPassword: string }) => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); if (!selected.length) { setFormError('Select at least one staff role.'); return; } setFormError(''); await onSubmit({ name: String(data.get('name')), email: String(data.get('email')), mobile: String(data.get('mobile')), temporaryPassword: String(data.get('password')), roles: selected }); }
  return <DialogShell title="Add staff" onClose={onClose}><form className="mt-4 space-y-3" onSubmit={submit}><Field id="new-staff-name" label="Name" name="name" required autoComplete="name" autoFocus /><Field id="new-staff-email" label="Email" name="email" type="email" required autoComplete="email" /><Field id="new-staff-mobile" label="Mobile" name="mobile" type="tel" required autoComplete="tel" /><Field id="new-staff-password" label="Temporary password" name="password" type="password" required minLength={8} autoComplete="new-password" hint="Staff will be required to set up 2FA at first login." /><RoleChecks roles={roles} selected={selected} setSelected={setSelected} />{formError && <p role="alert" className="text-sm text-danger">{formError}</p>}<div className="mt-5 flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button variant="ink" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create staff user'}</Button></div></form></DialogShell>;
}

function RolesDialog({ user, roles, busy, onClose, onSubmit }: { user: AdminStaffRow; roles: RoleOption[]; busy: boolean; onClose: () => void; onSubmit: (keys: string[]) => Promise<void> }) {
  const [selected, setSelected] = useState(user.roles.map((role) => role.key));
  const [formError, setFormError] = useState('');
  return <DialogShell title={`Edit roles for ${user.name}`} onClose={onClose}><RoleChecks roles={roles} selected={selected} setSelected={setSelected} />{formError && <p role="alert" className="mt-3 text-sm text-danger">{formError}</p>}<div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="ink" disabled={busy} onClick={async () => { if (!selected.length) { setFormError('Select at least one staff role.'); return; } setFormError(''); await onSubmit(selected); }}>{busy ? 'Saving…' : 'Save roles'}</Button></div></DialogShell>;
}

function ConfirmDialog({ dialog, busy, onClose, onConfirm }: { dialog: Extract<Dialog, { kind: 'confirm' }>; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const { action, user } = dialog;
  const copy = action === 'reset' ? ['Reset two-factor authentication?', 'This clears their 2FA setup and signs them out of every session. They will set up 2FA again after signing in.'] : action === 'deactivate' ? ['Deactivate staff user?', 'They will be signed out of every session and cannot sign in until reactivated.'] : ['Reactivate staff user?', 'This restores their ability to sign in.'];
  return <DialogShell title={copy[0]} onClose={onClose}><p className="mt-3 text-sm text-muted">{copy[1]} <span className="font-medium text-night">{user.name}</span></p><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="ink" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : action === 'reset' ? 'Reset 2FA' : action === 'deactivate' ? 'Deactivate' : 'Reactivate'}</Button></div></DialogShell>;
}
