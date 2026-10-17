'use client';

export default function ConsultantsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto max-w-3xl px-4 py-16" role="alert">
    <h1 className="text-2xl font-bold">Consultants are temporarily unavailable</h1>
    <p className="mt-2 text-muted">Please try again in a moment.</p>
    <button type="button" onClick={reset} className="mt-5 min-h-11 rounded-md bg-ink px-4 font-semibold text-white">Try again</button>
  </main>;
}
