import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[560px] px-4 py-20">
      <p className="num text-5xl font-bold text-ink/20">404</p>
      <h1 className="mt-2 text-2xl font-bold">Page not found</h1>
      <Link href="/" className="mt-6 inline-block font-medium text-ink underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
