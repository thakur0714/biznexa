'use client';

import { useEffect } from 'react';
import { Container } from '@biznexa/ui';

export default function BlogError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <Container className="py-16"><h1 className="text-3xl font-bold">Articles are unavailable</h1><p className="mt-3 text-muted">Please try again shortly.</p><button onClick={reset} className="mt-6 rounded-md bg-ink px-4 py-2 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Try again</button></Container>;
}
