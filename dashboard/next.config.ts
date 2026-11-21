import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'" },
      ],
    }];
  },
};

export default config;
