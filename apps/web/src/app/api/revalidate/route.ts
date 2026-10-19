import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  slugs: z.array(z.string().max(200)).max(10),
});

export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return NextResponse.json({ message: 'REVALIDATE_SECRET not set' }, { status: 503 });

  const providedSecret = req.headers.get('x-revalidate-secret');
  if (!providedSecret) return NextResponse.json({ message: 'Missing secret' }, { status: 401 });

  try {
    const a = Buffer.from(providedSecret);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ message: 'Invalid secret' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ message: 'Invalid secret' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: 'Invalid payload' }, { status: 400 });
  }

  // Every blog page (post, listing, category, tag), the home page's latest posts, and the sitemap.
  revalidatePath('/blog', 'layout');
  revalidatePath('/');
  revalidatePath('/sitemap.xml');
  const paths: Record<string, string> = { about: '/about', terms: '/terms', privacy: '/privacy', 'refund-policy': '/refund-policy', contact: '/contact' };
  for (const slug of parsed.data.slugs) {
    const path = paths[slug];
    if (path) revalidatePath(path);
  }

  return NextResponse.json({ revalidated: true });
}
