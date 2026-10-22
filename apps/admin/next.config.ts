import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** HSTS in production only (M12.1): on http://localhost it would pin the dev host to https. Two years, like the API. */
const hsts = process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : [];

const config: NextConfig = {
  transpilePackages: ['@biznexa/types', '@biznexa/ui', '@biznexa/api-client'],
  poweredByHeader: false,
  // Same-origin /api rewrite as the website (D11), so the refresh-token cookie stays first-party.
  rewrites() {
    return Promise.resolve([{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }]);
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          ...hsts,
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]);
  },
};

export default withSentryConfig(config, { silent: true, sourcemaps: { disable: true } });
