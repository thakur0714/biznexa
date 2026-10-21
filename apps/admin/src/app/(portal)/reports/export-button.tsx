'use client';

import { useState } from 'react';
import { Button } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import type { ReportExportType } from '@biznexa/types';

interface ExportButtonProps {
  type: ReportExportType;
  preset?: string;
  from?: string;
  to?: string;
  serviceId?: string;
  categoryId?: string;
}

export function ExportButton({ type, preset, from, to, serviceId, categoryId }: Readonly<ExportButtonProps>) {
  const { call } = useApi();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const job = await call<{ id: string }>((api) =>
        api.POST('/api/admin/reports/export', {
          body: {
            type,
            ...(preset ? { preset } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(serviceId ? { serviceId } : {}),
            ...(categoryId ? { categoryId } : {}),
          },
        }),
      );

      // Poll for download link up to 30 seconds
      const start = Date.now();
      let linkUrl: string | null = null;
      while (Date.now() - start < 30_000) {
        try {
          const res = await /* NOSONAR: polling must remain sequential until export readiness */ call<{ url: string }>((api) =>
            api.POST('/api/admin/reports/export/{id}/link', {
              params: { path: { id: job.id } },
            }),
          );
          if (res?.url) {
            linkUrl = res.url;
            break;
          }
        } catch {
          // 409 means still being prepared, wait 1s before retry
          await new Promise((r) => setTimeout(r, 1000)); // NOSONAR: retry delay must finish before the next poll starts
        }
      }

      if (!linkUrl) {
        throw new Error('Export timed out. Please try again.');
      }

      if (typeof window !== 'undefined') {
        window.location.assign(linkUrl);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={exporting}
      >
        {exporting ? 'Exporting...' : 'Export'}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
