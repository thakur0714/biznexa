import type { MetadataRoute } from 'next';

/** Search engines are kept out of the whole site for now (no sitemap either). */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] };
}
