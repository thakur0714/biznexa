import { Container } from '@biznexa/ui';

export default function BlogLoading() {
  return <Container className="py-16" aria-busy="true"><p role="status" className="text-muted">Loading articles…</p><div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-xl border border-rule bg-white" />)}</div></Container>;
}
