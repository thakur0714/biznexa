'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CertificateImportPreviewResponse } from '@biznexa/types';
import { Badge, Button, Notice } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

export function CertificateImportView() {
  const { user } = useAuth();
  const item = findNavItem('certificates');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <CertificateImportForm />;
}

function CertificateImportForm() {
  const api = useApi();
  const router = useRouter();

  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<CertificateImportPreviewResponse | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const certificateCountSuffix = previewResult?.validRows === 1 ? '' : 's';
  const importButtonLabel = importing ? 'Importing in Transaction…' : `Import ${previewResult?.validRows ?? 0} Certificate${certificateCountSuffix}`;
  const errorKeyCounts = new Map<string, number>();

  function errorKey(error: CertificateImportPreviewResponse['errors'][number]) {
    const raw = `${error.rowNumber}:${error.field ?? ''}:${error.message}`;
    const count = (errorKeyCounts.get(raw) ?? 0) + 1;
    errorKeyCounts.set(raw, count);
    return count === 1 ? raw : `${raw}#${count}`;
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorNotice('Please select a valid CSV file (.csv)');
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setErrorNotice(null);
    setPreviewResult(null);
    setSuccessCount(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      setCsvContent(content);
    };
    reader.onerror = () => {
      setErrorNotice('Failed to read the selected file. Please try again.');
    };
    reader.readAsText(file);
  };

  const handleValidate = async () => {
    if (!csvContent.trim()) {
      setErrorNotice('Please select or upload a CSV file first');
      return;
    }

    setValidating(true);
    setErrorNotice(null);
    try {
      const res = await api.call((c) =>
        c.POST('/api/admin/certificates/import/preview', {
          body: { csv: csvContent },
        }),
      );
      setPreviewResult(res as CertificateImportPreviewResponse);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to validate CSV file';
      setErrorNotice(msg);
    } finally {
      setValidating(false);
    }
  };

  const handleImport = async () => {
    if (!csvContent.trim() || !previewResult) return;
    if (previewResult.errors.length > 0) {
      setErrorNotice('Cannot import while there are validation errors. Please fix them and re-validate.');
      return;
    }

    setImporting(true);
    setErrorNotice(null);
    try {
      const res = await api.call((c) =>
        c.POST('/api/admin/certificates/import', {
          body: { csv: csvContent },
        }),
      );
      setSuccessCount((res as { importedCount: number }).importedCount);
      setPreviewResult(null);
      setCsvContent('');
      setFileName('');
      setFileSize(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      setErrorNotice(msg);
    } finally {
      setImporting(false);
    }
  };

  // Downloads go through the API client: the access token lives in memory, not in localStorage.
  const saveBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      const blob = await api.call<Blob>((c) => c.GET('/api/admin/certificates/import/template', { parseAs: 'blob' }));
      saveBlob(blob, 'certificate-import-template.csv');
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not download the template.');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleDownloadErrorReport = async () => {
    if (!previewResult || previewResult.errors.length === 0) return;
    setDownloadingReport(true);
    try {
      const blob = await api.call<Blob>((c) =>
        c.POST('/api/admin/certificates/import/error-report', { body: { errors: previewResult.errors }, parseAs: 'blob' }),
      );
      saveBlob(blob, `certificate-import-errors-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not download the error report.');
    } finally {
      setDownloadingReport(false);
    }
  };

  return (
    <div className="max-w-[1000px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="text-xs text-muted">
            <Link href="/certificates" className="hover:underline">
              Certificates
            </Link>{' '}
            / Bulk Import
          </nav>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em]">Bulk Import Certificates (CSV)</h1>
          <p className="mt-1 text-muted">
            Upload a CSV spreadsheet to validate and batch-issue multiple certificates in a single atomic transaction.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadTemplate} disabled={downloadingTemplate}>
            {downloadingTemplate ? 'Downloading…' : 'Download CSV Template'}
          </Button>
          <Link
            href="/certificates"
            className="inline-flex items-center rounded-md border border-rule bg-white px-3 py-2 text-sm font-medium text-night hover:bg-paper"
          >
            Back to certificates
          </Link>
        </div>
      </div>

      {successCount !== null && (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">
              ✓
            </div>
            <div>
              <h2 className="text-lg font-semibold">Bulk Import Completed Successfully</h2>
              <p className="text-sm text-emerald-800">
                Successfully imported {successCount} certificate{successCount === 1 ? '' : 's'} in a single transaction.
                Official PDFs are being generated in the background.
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <Button variant="primary" onClick={() => router.push('/certificates')}>
              View Certificates List
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSuccessCount(null);
                setPreviewResult(null);
              }}
            >
              Import More
            </Button>
          </div>
        </div>
      )}

      {errorNotice && (
        <div className="mt-4">
          <Notice tone="error">{errorNotice}</Notice>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-rule bg-white p-6 shadow-xs">
        <h2 className="text-base font-semibold text-night">Upload CSV Spreadsheet</h2>
        <p className="mt-1 text-xs text-muted">
          Ensure your CSV contains columns for Certificate Type, Organisation Name, Valid From, Valid Until, and
          Certification Body. Certificate Number is optional (auto-generated if omitted).
        </p>

        <div className="mt-4">
          <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-rule bg-paper/50 p-6 text-center hover:bg-paper cursor-pointer transition">
            <svg
              className="h-10 w-10 text-muted"
              stroke="currentColor"
              fill="none"
              viewBox="0 0 48 48"
              aria-hidden="true"
            >
              <path
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="mt-2 text-sm font-medium text-night">
              {fileName ? fileName : 'Click to select or drag and drop your CSV file'}
            </p>
            <p className="mt-1 text-xs text-muted">
              {fileSize ? `${(fileSize / 1024).toFixed(1)} KB` : 'CSV spreadsheet up to 5 MB'}
            </p>
            <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted">
            {fileName ? (
              <span>
                Selected: <strong>{fileName}</strong>
              </span>
            ) : (
              'No file chosen yet'
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={handleValidate}
              disabled={validating || !csvContent.trim()}
            >
              {validating ? 'Validating CSV…' : 'Validate & Preview'}
            </Button>
          </div>
        </div>
      </div>

      {previewResult && (
        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-rule bg-white p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-night">Validation Summary</h2>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <Badge tone="neutral">Total rows: {previewResult.totalRows}</Badge>
                  <Badge tone={previewResult.validRows > 0 ? 'success' : 'neutral'}>
                    Valid rows: {previewResult.validRows}
                  </Badge>
                  <Badge tone={previewResult.invalidRows > 0 ? 'danger' : 'success'}>
                    Invalid rows: {previewResult.invalidRows}
                  </Badge>
                </div>
              </div>

              <div className="flex gap-2">
                {previewResult.errors.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={handleDownloadErrorReport}
                    disabled={downloadingReport}
                  >
                    {downloadingReport ? 'Preparing report…' : 'Download Error Report (CSV)'}
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={handleImport}
                  disabled={importing || previewResult.errors.length > 0 || previewResult.validRows === 0}
                >
                  {importButtonLabel}
                </Button>
              </div>
            </div>

            {previewResult.errors.length > 0 && (
              <div className="mt-6">
                <Notice tone="error">
                  Found {previewResult.errors.length} validation error(s) across {previewResult.invalidRows} row(s).
                  Fix these issues in your CSV and re-upload, or download the error report below.
                </Notice>

                <div className="mt-3 max-h-60 overflow-y-auto rounded-md border border-red-200 bg-red-50/50 p-3">
                  <ul className="divide-y divide-red-200/60 text-xs">
                    {previewResult.errors.map((err) => (
                      <li key={errorKey(err)} className="py-1.5 flex items-start gap-2 text-red-800">
                        <span className="font-mono font-semibold text-red-900 whitespace-nowrap">
                          Row {err.rowNumber}
                          {err.field ? ` (${err.field})` : ''}:
                        </span>
                        <span>{err.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {previewResult.preview.length > 0 && (
            <div className="rounded-lg border border-rule bg-white p-6 shadow-xs">
              <h2 className="text-base font-semibold text-night">
                Valid Rows Preview (First {previewResult.preview.length} of {previewResult.validRows})
              </h2>
              <p className="mt-1 text-xs text-muted">
                These records are validated and ready to be committed atomically.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-rule bg-paper text-muted">
                    <tr>
                      <th className="p-2">Row</th>
                      <th className="p-2">Certificate No.</th>
                      <th className="p-2">Organisation</th>
                      <th className="p-2">Standard</th>
                      <th className="p-2">Certification Body</th>
                      <th className="p-2">Validity</th>
                      <th className="p-2">Public PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule font-sans">
                    {previewResult.preview.map((row) => (
                      <tr key={row.rowNumber} className="hover:bg-paper/40">
                        <td className="p-2 font-mono text-muted">{row.rowNumber}</td>
                        <td className="p-2 font-mono font-semibold text-night">
                          {row.certificateNumber || <span className="text-muted italic">Auto-generated</span>}
                        </td>
                        <td className="p-2 font-medium text-night">{row.organizationName}</td>
                        <td className="p-2 text-muted">{row.type}</td>
                        <td className="p-2 text-muted">{row.certificationBodyName}</td>
                        <td className="p-2 whitespace-nowrap text-muted">
                          {row.validFrom} to {row.validUntil}
                        </td>
                        <td className="p-2">
                          <Badge tone={row.showPdfPublicly ? 'success' : 'neutral'}>
                            {row.showPdfPublicly ? 'Yes' : 'No'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
