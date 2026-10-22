import { Container } from '@biznexa/ui';

export default function ConsultantsLoading() {
  return (
    <Container className="animate-pulse py-8 sm:py-12">
      <output className="sr-only">Loading consultants…</output>
      <div className="h-9 w-64 rounded bg-paper" />
      <div className="mt-6 h-48 rounded-xl border border-rule bg-white" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((item) => (
          <div key={item} className="h-64 rounded-xl border border-rule bg-white" />
        ))}
      </div>
    </Container>
  );
}
