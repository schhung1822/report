import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // proxy.ts runs on every request, and Next.js then keeps only the first 10 MB of a request body (the rest is silently cut
    // off). "Gửi Lark" uploads the report to /api/lark/* (image up to 10 MB, PDF up to 30 MB), so allow a little more than that.
    proxyClientMaxBodySize: "40mb",
  },
};

export default nextConfig;
