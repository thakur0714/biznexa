'use client';

import { Button, Container } from '@biznexa/ui';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <Container className="max-w-[640px] py-20">
      <h1 className="text-3xl font-bold tracking-[-0.02em]">This page didn’t load</h1>
      <p className="mt-2 text-muted">Our servers didn’t respond in time. Your data is safe. Try again in a moment.</p>
      <Button variant="ink" className="mt-6" onClick={reset}>
        Try again
      </Button>
    </Container>
  );
}
