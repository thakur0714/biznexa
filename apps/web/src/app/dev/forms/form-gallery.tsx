'use client';

import { useState } from 'react';
import { formSchema, GENERIC_SERVICE_FORM, SERVICE_FORMS, type FormData, type FormSchemaInput } from '@biznexa/types';
import { ApplicationForm, Container, Notice, Select, type UploadFiles } from '@biznexa/ui';

const FORMS: Record<string, FormSchemaInput> = { ...SERVICE_FORMS, generic: GENERIC_SERVICE_FORM };

/** Nothing is uploaded here: each chosen file stands in as a made-up file id. */
const fakeUpload: UploadFiles = (files) => Promise.resolve(files.map(() => crypto.randomUUID()));

export function FormGallery() {
  const [slug, setSlug] = useState('private-limited-company-registration');
  const [result, setResult] = useState<FormData | null>(null);
  const form = formSchema.parse(FORMS[slug]);

  return (
    <Container className="max-w-[760px] py-10">
      <h1 className="text-2xl font-bold tracking-[-0.02em]">Application forms</h1>
      <p className="mt-1 text-muted">Development only. Every ready-made form as customers will see it; answers are not saved.</p>
      <Select
        id="form-slug"
        label="Form"
        className="mt-6 max-w-sm"
        value={slug}
        onChange={(e) => {
          setSlug(e.target.value);
          setResult(null);
        }}
      >
        {Object.keys(FORMS).map((s) => (
          <option key={s}>{s}</option>
        ))}
      </Select>
      <div className="mt-6">
        <ApplicationForm key={slug} form={form} uploadFiles={fakeUpload} onSubmit={setResult} />
      </div>
      {result && (
        <div className="mt-6">
          <Notice tone="success">
            Every answer passes. This is what would be stored:
            <pre className="mt-2 max-h-80 overflow-auto rounded bg-white/70 p-2 text-xs text-night">{JSON.stringify(result, null, 2)}</pre>
          </Notice>
        </div>
      )}
    </Container>
  );
}
