'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { needsUpload, type CustomerDocuments, type CustomerDocumentsQuery, type DocumentChecklist } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Button, EmptyState, LinkButton, Notice } from '@biznexa/ui';
import { DocumentRow } from '@/components/document-row';

type Filter = CustomerDocumentsQuery['status'];

function isActionItem(item: CustomerDocuments[number]['checklist']['items'][number]) {
  return (item.requirement.isMandatory && needsUpload(item)) || (item.current !== null && needsUpload(item));
}

export function DocumentsView() {
  const api = useApi();
  const [filter, setFilter] = useState<Filter>('needs_action');
  const [result, setResult] = useState<{ filter: Filter; groups: CustomerDocuments } | null>(null);
  const [failure, setFailure] = useState<{ filter: Filter; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.call<CustomerDocuments>((client) => client.GET('/api/documents', { params: { query: { status: filter } } }))
      .then((groups) => {
        if (!cancelled) {
          setResult({ filter, groups });
          setFailure(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure({ filter, message: cause instanceof ClientApiError ? cause.message : 'We couldn’t load your documents.' });
      });
    return () => { cancelled = true; };
  }, [api, filter]);

  function updateChecklist(applicationId: string, checklist: DocumentChecklist) {
    setResult((current) => current?.filter === filter ? {
      ...current,
      groups: current.groups.map((group) => group.applicationId === applicationId ? { ...group, checklist } : group),
    } : current);
  }

  const groups = result?.filter === filter ? result.groups : null;
  const error = failure?.filter === filter ? failure.message : '';

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-[-0.025em]">Documents</h1>
        <p className="mt-1 text-muted">View and manage documents across your applications.</p>
      </div>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Filter documents</legend>
        <Button type="button" size="sm" variant={filter === 'needs_action' ? 'ink' : 'outline'} aria-pressed={filter === 'needs_action'} onClick={() => setFilter('needs_action')}>
          Needs action
        </Button>
        <Button type="button" size="sm" variant={filter === 'all' ? 'ink' : 'outline'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Button>
      </fieldset>

      {error && <Notice tone="error">{error}</Notice>}
      {!groups && !error && <output className="block text-sm text-muted">Loading your documents…</output>}
      {groups?.length === 0 && (
        <EmptyState
          className="p-8"
          titleAs="h2"
          title={filter === 'needs_action' ? 'You’re all caught up' : 'No documents yet'}
          description={filter === 'needs_action' ? 'Documents that need an upload or replacement will appear here.' : 'Documents for your applications will appear here.'}
          action={<LinkButton href="/dashboard/services">View my services</LinkButton>}
        />
      )}

      {groups?.map((group) => {
        const items = filter === 'all' ? group.checklist.items : group.checklist.items.filter(isActionItem);
        const additional = filter === 'all' ? group.checklist.additional : group.checklist.additional.filter(needsUpload);
        return (
          <section key={group.applicationId} aria-labelledby={`application-${group.applicationId}`} className="space-y-3">
            <header className="flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-3">
              <div className="min-w-0">
                <h2 id={`application-${group.applicationId}`} className="truncate text-lg font-semibold">{group.serviceName}</h2>
                <p className="text-sm text-muted">{group.applicationCode}</p>
              </div>
              <Link href={`/dashboard/applications/${group.applicationId}`} className="text-sm font-medium text-ink hover:underline">View application</Link>
            </header>
            <ul className="space-y-3">
              {items.map((item) => (
                <DocumentRow key={item.requirement.id} target={{ kind: 'requirement', item }} applicationId={group.applicationId} canUpload={group.checklist.canUpload} onChange={(next) => updateChecklist(group.applicationId, next)} />
              ))}
              {additional.map((item) => (
                <DocumentRow key={item.request.id} target={{ kind: 'additional', item }} applicationId={group.applicationId} canUpload={group.checklist.canUpload} onChange={(next) => updateChecklist(group.applicationId, next)} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
