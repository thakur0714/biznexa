'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { prefillAnswers, type ApplicationDetail, type FormSchema } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { ApplicationForm, Breadcrumbs, Button, LinkButton, Notice, type FormErrors, type FormValues, type UploadFiles } from '@biznexa/ui';
import { useAuth } from '@/lib/auth';
import type { ServiceDetail } from '@/lib/api';

/** How long to wait after the customer stops typing before autosaving (M3.9). */
const AUTOSAVE_DELAY_MS = 1000;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Loaded {
  app: ApplicationDetail;
  form: FormSchema;
  initialValues: FormValues;
  initialStep: number;
}

/** The step the customer was on, per application and per browser — a convenience, so failures are ignored. */
const stepKey = (id: string) => `bn_apply_step:${id}`;
function readStep(id: string): number {
  try {
    const n = Number(localStorage.getItem(stepKey(id)));
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
function writeStep(id: string, step: number) {
  try {
    localStorage.setItem(stepKey(id), String(step));
  } catch {
    // Private mode or blocked storage: the form simply opens on step 1 next time.
  }
}

/** `[{ field: 'directors.0.pan', message }]` from the API → the form's `{ path: message }`. */
const toFormErrors = (e: ClientApiError): FormErrors => Object.fromEntries(e.errors.map((f) => [f.field, f.message]));

/**
 * The application's form page (M3.9). Loads the draft with the form version it was started on and,
 * the first time (no answers yet), prefills from the chosen business and the customer's account.
 * Answers are autosaved a second after the customer stops typing, and again straight away when the tab
 * is hidden; they live on the server, so a refresh or another device resumes where they left off.
 * "Save and continue" sends the answers with `final: true` and the server checks every rule, then
 * moves on to the document step (M3.10).
 */
export function ApplyForm({ service, applicationId }: Readonly<{ service: ServiceDetail; applicationId: string }>) {
  const api = useApi();
  const router = useRouter();
  const { user } = useAuth();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const app = loaded?.app;

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const detail = await api.call<ApplicationDetail>((c) => c.GET('/api/applications/{id}', { params: { path: { id: applicationId } } }));
        // The id is the customer's own, but the URL names a service too: don't show one service's form under another's name.
        if (detail.serviceId !== service.id) throw new ClientApiError(404, 'Application not found');

        let values = detail.formData as FormValues;
        if (Object.keys(values).length === 0) {
          const business = detail.businessEntityId
            ? await api.call((c) => c.GET('/api/business-entities/{id}', { params: { path: { id: detail.businessEntityId! } } })).catch(() => null)
            : null;
          values = prefillAnswers(detail.formSchema, { business, user });
        }
        if (live) setLoaded({ app: detail, form: detail.formSchema, initialValues: values, initialStep: readStep(applicationId) });
      } catch (e) {
        if (live) setLoadError((e as ClientApiError).message);
      }
    })();
    return () => {
      live = false;
    };
    // `user` only seeds the prefill on first load; a token refresh must not reload the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, applicationId, service.id]);

  // Autosave. `pending` holds answers not yet sent; one save runs at a time and the newest answers
  // always go last, so a slow earlier save can never overwrite later typing.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<FormValues | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const editable = app?.status === 'DRAFT' && !submitted;

  function flush(): Promise<void> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // A save already on its way sends whatever is pending when it finishes.
    if (inflight.current) return inflight.current;
    if (!editable || pending.current === null) return Promise.resolve();
    const formData = pending.current;
    pending.current = null;
    setSaveState('saving');
    const run = (async () => {
      let ok = false;
      try {
        await api.call((c) => c.PATCH('/api/applications/{id}', { params: { path: { id: applicationId } }, body: { formData } }));
        ok = true;
        setSaveState('saved');
      } catch (e) {
        // Keep the answers so "Try again", the next change or leaving the tab sends them again.
        pending.current ??= formData;
        setSaveState('error');
        setSaveError((e as ClientApiError).message);
      } finally {
        inflight.current = null;
      }
      if (ok && pending.current !== null) await flush();
    })();
    inflight.current = run;
    return run;
  }

  function onChange(values: FormValues) {
    pending.current = values;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }

  // Save at once when the tab is hidden (switching apps on a phone often ends in the tab being killed),
  // and warn before closing or reloading while answers are still unsaved.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushRef.current();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current === null && !inflight.current) return;
      void flushRef.current();
      e.preventDefault();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onSubmit(formData: Record<string, unknown>): Promise<FormErrors | void> {
    setSubmitError('');
    // The final save carries every answer, so a queued autosave is no longer needed; one already
    // on its way is allowed to finish first so it cannot land after the final save.
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    await inflight.current;
    try {
      await api.call((c) => c.PATCH('/api/applications/{id}', { params: { path: { id: applicationId } }, body: { formData, final: true } }));
      pending.current = null; // a failed autosave before it is superseded
      setSaveState('saved');
      setSubmitted(true);
      router.push(`/apply/${service.slug}/${applicationId}/documents`);
    } catch (e) {
      const err = e as ClientApiError;
      setSubmitError(err.message);
      return toFormErrors(err);
    }
  }

  /** File fields upload each file through the shared upload endpoint (M2.5.6) and keep the returned ids. */
  const uploadFiles: UploadFiles = async (files) => {
    const ids: string[] = [];
    for (const file of files) {
      const body = new FormData();
      body.append('file', file);
      const stored = await api.call<{ id: string }>((c) => c.POST('/api/files', { // NOSONAR: files upload one at a time, in the order chosen.
        body: { file: file.name },
        bodySerializer: () => body,
      }));
      ids.push(stored.id);
    }
    return ids;
  };

  let status = 'Answers save as you type';
  if (saveState === 'saving') status = 'Saving…';
  else if (saveState === 'saved') status = 'All answers saved';
  else if (saveState === 'error') status = `Not saved. ${saveError}`;

  let formContent: React.ReactNode = null;
  if (submitted) {
    formContent = (
      <div className="mt-6">
        <Notice tone="success">
          Your details are saved. Opening the document step for application <strong className="num">{loaded?.app.code}</strong>…
        </Notice>
      </div>
    );
  } else if (loaded?.app.status === 'DRAFT') {
    formContent = (
      <div className="mt-6">
        <ApplicationForm
          form={loaded.form}
          initialValues={loaded.initialValues}
          initialStep={loaded.initialStep}
          onChange={onChange}
          onStepChange={(step) => writeStep(applicationId, step)}
          onSubmit={onSubmit}
          submitLabel="Save and continue"
          uploadFiles={uploadFiles}
          idPrefix="apply"
        />
      </div>
    );
  } else if (loaded) {
    formContent = (
      <div className="mt-6 space-y-4">
        <Notice tone="info">
          Application <strong className="num">{loaded.app.code}</strong> has already moved past this step, so its answers can’t be changed here.
        </Notice>
        <LinkButton href="/dashboard" variant="outline">
          Go to your dashboard
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ href: `/services/${service.category.slug}/${service.slug}`, label: service.name }, { label: 'Your details' }]} />
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.025em]">Your details</h1>
          {app && (
            <p className="mt-1 text-sm text-muted">
              {service.name} · Application <span className="num">{app.code}</span>
            </p>
          )}
        </div>
        {loaded && editable && (
          <div className="flex items-center gap-3">
            <p aria-live="polite" className={`text-sm ${saveState === 'error' ? 'text-danger' : 'text-muted'}`}>
              {status}
            </p>
            {saveState === 'error' && (
              <Button type="button" variant="outline" size="sm" onClick={() => void flush()}>
                Try again
              </Button>
            )}
          </div>
        )}
      </div>

      {loadError && (
        <div className="mt-6 space-y-4">
          <Notice tone="error">{loadError}</Notice>
          <LinkButton href={`/services/${service.category.slug}/${service.slug}`} variant="outline">
            Back to {service.name}
          </LinkButton>
        </div>
      )}

      {submitError && (
        <div className="mt-6">
          <Notice tone="error">{submitError}</Notice>
        </div>
      )}

      {loaded && formContent}
    </div>
  );
}
