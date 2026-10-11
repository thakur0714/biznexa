import { SearchBox } from '@/components/search-box';
import { Container, LinkButton } from '@biznexa/ui';

export default function NotFound() {
  return (
    <Container className="max-w-[640px] py-20">
      <p className="num text-6xl font-bold text-ink/20">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em]">We couldn’t find that page</h1>
      <p className="mt-2 text-muted">The link may be old or mistyped. Search for the service you need instead.</p>
      <div className="mt-8">
        <SearchBox size="md" />
      </div>
      <div className="mt-6">
        <LinkButton href="/" variant="outline">
          Go to the homepage
        </LinkButton>
      </div>
    </Container>
  );
}
