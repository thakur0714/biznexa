'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type ApplicationDetail, type DocumentChecklist } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Breadcrumbs, Button, LinkButton, Notice } from '@biznexa/ui';
import { DocumentRow } from '@/components/document-row';
import type { ServiceDetail } from '@/lib/api';

/**
 * The document step (M3.10). Lists the documents this package needs; each one uploads through the shared
 * upload endpoint with that document's rules and is then attached to the application. Replacing a file
 * adds a new version (earlier ones are kept). Mandatory documents can be skipped and uploaded later.
 * Continue (or skip) goes on to the order summary (M3.13).
 */
export function DocumentsStep({ service, applicationId }: Readonly<{ service: ServiceDetail; applicationId: string }>) {
  const api = useApi();
  const router = useRouter();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [list, setList] = useState<DocumentChecklist | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const path = { params: { path: { id: applicationId } } };
        const [detail, checklist] = await Promise.all([
          api.call<ApplicationDetail>((c) => c.GET('/api/applications/{id}', path)),
          api.call<DocumentChecklist>((c) => c.GET('/api/applications/{id}/documents', path)),
        ]);
        if (detail.serviceId !== service.id) throw new ClientApiError(404, 'Application not found');
        if (live) {
          setApp(detail);
          setList(checklist);
        }
      } catch (e) {
        if (live) setLoadError((e as ClientApiError).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, applicationId, service.id]);

  const serviceHref = `/services/${service.category.slug}/${service.slug}`;
  const pending = list?.pendingMandatory ?? 0;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <Breadcrumbs
        items={[
          { href: serviceHref, label: service.name },
          { href: `/apply/${service.slug}/${applicationId}`, label: 'Your details' },
          { label: 'Documents' },
        ]}
      />
      <h1 className="mt-4 text-3xl font-bold tracking-[-0.025em]">Documents</h1>
      {app && (
        <p className="mt-1 text-sm text-muted">
          {service.name} · Application <span className="num">{app.code}</span>
        </p>
      )}

      {loadError && (
        <div className="mt-6 space-y-4">
          <Notice tone="error">{loadError}</Notice>
          <LinkButton href={serviceHref} variant="outline">
            Back to {service.name}
          </LinkButton>
        </div>
      )}

      {!list && !loadError && (
        <output className="mt-6 block text-sm text-muted">
          Loading your document checklist…
        </output>
      )}

      {list && (
        <>
          {!list.canUpload && (
            <div className="mt-6">
              <Notice tone="info">This application is past the document step, so its documents can’t be changed here.</Notice>
            </div>
          )}
          {list.additional.length > 0 && (
            <section className="mt-6" aria-labelledby="requested-docs">
              <h2 id="requested-docs" className="text-lg font-semibold">
                Requested by our team
              </h2>
              <p className="mt-1 text-sm text-muted">We need these to continue with your application.</p>
              <ul className="mt-4 space-y-4">
                {list.additional.map((item) => (
                  <DocumentRow
                    key={item.request.id}
                    target={{ kind: 'additional', item }}
                    applicationId={applicationId}
                    canUpload={list.canUpload}
                    onChange={setList}
                  />
                ))}
              </ul>
            </section>
          )}
          {list.items.length === 0 ? (
            list.additional.length === 0 && (
              <p className="mt-6 text-muted">This service needs no documents from you. Continue to the next step.</p>
            )
          ) : (
            <>
              <p className="mt-4 text-muted">
                Upload clear scans or photos. You can skip any document now and upload it later from your dashboard.
              </p>
              <ul className="mt-6 space-y-4">
                {list.items.map((item) => (
                  <DocumentRow
                    key={item.requirement.id}
                    target={{ kind: 'requirement', item }}
                    applicationId={applicationId}
                    canUpload={list.canUpload}
                    onChange={setList}
                  />
                ))}
              </ul>
            </>
          )}

          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between">
            <LinkButton href={`/apply/${service.slug}/${applicationId}`} variant="ghost">
              Back to your details
            </LinkButton>
            <div className="flex flex-col gap-2 sm:items-end">
              {pending > 0 && (
                <p className="text-sm text-muted" aria-live="polite">
                  {pending === 1 ? '1 required document' : `${pending} required documents`} still to upload
                </p>
              )}
              <Button
                type="button"
                variant={pending > 0 ? 'outline' : 'primary'}
                onClick={() => router.push(`/apply/${service.slug}/${applicationId}/summary`)}
              >
                {pending > 0 ? 'Skip and upload later' : 'Continue'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
