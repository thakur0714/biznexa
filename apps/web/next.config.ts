import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** HSTS in production only (M12.1): on http://localhost it would pin the dev host to https. Two years, like the API. */
const hsts = process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : [];

const config: NextConfig = {
  transpilePackages: ['@biznexa/types', '@biznexa/ui', '@biznexa/api-client', '@biznexa/rich-text'],
  poweredByHeader: false,
  // Browser calls go to /api on the same origin, so the refresh-token cookie stays first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          ...hsts,
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
