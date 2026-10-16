'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  formatDate,
  type CustomerApplicationTimeline,
  type CustomerStageState,
  type CustomerTimelineStage,
} from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Badge, EmptyState, LinkButton, Notice, type Tone } from '@biznexa/ui';
import { Icon } from '@/components/icons';
import { applicationStatusTone } from '../../services/services-view';

function stageStateBadge(state: CustomerStageState): { label: string; tone: Tone } {
  switch (state) {
    case 'done':
      return { label: 'Completed', tone: 'success' };
    case 'current':
      return { label: 'In progress', tone: 'info' };
    case 'upcoming':
      return { label: 'Upcoming', tone: 'neutral' };
  }
}

function StageStepIcon({ stage, index }: { stage: CustomerTimelineStage; index: number }) {
  if (stage.state === 'done') {
    return (
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs"
      >
        <Icon name="check" size={16} />
      </span>
    );
  }
  if (stage.state === 'current') {
    return (
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface text-xs font-bold text-ink ring-4 ring-ink/10"
      >
        {index + 1}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rule bg-paper text-xs font-semibold text-muted"
    >
      {index + 1}
    </span>
  );
}

export function ApplicationDetailView({ applicationId }: { applicationId: string }) {
  const api = useApi();
  const [loadedForId, setLoadedForId] = useState<string>(applicationId);
  const [timeline, setTimeline] = useState<CustomerApplicationTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loadedForId !== applicationId) {
    setLoadedForId(applicationId);
    setTimeline(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;

    api
      .call<CustomerApplicationTimeline>((c) =>
        c.GET('/api/applications/{id}/timeline', {
          params: { path: { id: applicationId } },
        }),
      )
      .then((res) => {
        if (!cancelled) {
          setTimeline(res);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ClientApiError ? err.message : 'Failed to load application details.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, applicationId]);

  const loading = timeline === null && !error;

  if (loading) {
    return (
      <div className="rounded-lg border border-rule bg-white p-10 text-center text-sm text-muted" role="status">
        Loading application details…
      </div>
    );
  }

  if (error || !timeline) {
    return (
      <div className="space-y-4">
        <Notice tone="error">{error ?? 'Application not found.'}</Notice>
        <LinkButton href="/dashboard/services" variant="outline" size="sm">
          Back to My Services
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/dashboard/services"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
        >
          <span>←</span>
          <span>Back to My Services</span>
        </Link>
      </div>

      {/* Header */}
      <header className="rounded-lg border border-rule bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num font-mono text-xs font-bold text-muted" data-testid="application-code">
                {timeline.code}
              </span>
              <Badge tone={applicationStatusTone(timeline.status)}>{timeline.statusLabel}</Badge>
            </div>
            <h1 className="text-xl font-bold tracking-[-0.02em] text-night sm:text-2xl">
              {timeline.serviceName}
            </h1>
            <p className="text-sm text-muted">
              <span className="font-semibold text-ink">{timeline.packageName}</span> package · Started{' '}
              {formatDate(timeline.createdAt)}
            </p>
          </div>
          {timeline.assignedExpert && (
            <div className="shrink-0 rounded-md border border-rule bg-paper px-3.5 py-2 text-xs">
              <p className="font-semibold uppercase tracking-[0.06em] text-muted">Assigned expert</p>
              <p className="mt-0.5 text-sm font-semibold text-night">{timeline.assignedExpert.name}</p>
            </div>
          )}
        </div>
      </header>

      {/* Service Stages Vertical Stepper */}
      <section aria-labelledby="timeline-heading" className="rounded-lg border border-rule bg-white p-5 sm:p-6">
        <div className="mb-5">
          <h2 id="timeline-heading" className="text-lg font-bold text-night">
            Application Timeline
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Live progress across every stage of your {timeline.serviceName} application.
          </p>
        </div>

        {timeline.stages.length === 0 ? (
          <EmptyState
            title="No stages configured"
            description="Stage progress will appear here as our team works on your application."
          />
        ) : (
          <ol className="space-y-0" aria-label="Service stages">
            {timeline.stages.map((stage, idx) => {
              const isLast = idx === timeline.stages.length - 1;
              const badge = stageStateBadge(stage.state);
              const stageNotes = timeline.history.filter((h) => h.stageId === stage.id && h.note);

              return (
                <li
                  key={stage.id}
                  data-stage-state={stage.state}
                  className="relative flex gap-4 pb-6 last:pb-0"
                >
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className={`absolute top-8 left-4 -ml-px h-[calc(100%-2rem)] w-0.5 ${
                        stage.state === 'done' ? 'bg-emerald-500' : 'bg-rule'
                      }`}
                    />
                  )}
                  <StageStepIcon stage={stage} index={idx} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3
                          className={`text-sm font-bold ${
                            stage.state === 'upcoming' ? 'text-muted' : 'text-night'
                          }`}
                        >
                          {stage.name}
                        </h3>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </div>
                      {stage.reachedAt && (
                        <span className="num text-xs font-medium text-muted">
                          {formatDate(stage.reachedAt)}
                        </span>
                      )}
                    </div>
                    {stage.description && (
                      <p className="mt-1 text-xs leading-relaxed text-muted">{stage.description}</p>
                    )}
                    {stageNotes.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {stageNotes.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-md border border-rule bg-paper px-3 py-2 text-xs text-ink"
                          >
                            <p>{entry.note}</p>
                            <p className="mt-0.5 text-[11px] text-muted">{formatDate(entry.changedAt)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Customer-visible status history & notes */}
        {timeline.history.length > 0 && (
          <div className="mt-6 border-t border-rule pt-5">
            <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-muted">Status updates</h3>
            <ul className="mt-3 space-y-3" aria-label="Status history">
              {timeline.history.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-1 rounded-md border border-rule bg-paper/60 px-3.5 py-2.5 text-xs sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-night">{item.statusLabel}</span>
                      {item.stageName && (
                        <span className="text-muted">· {item.stageName}</span>
                      )}
                    </div>
                    {item.note && <p className="text-ink">{item.note}</p>}
                  </div>
                  <span className="num shrink-0 text-muted">{formatDate(item.changedAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
