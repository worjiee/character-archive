import type { NextConfig } from "next";
import { APPLICATION_SECURITY_HEADERS } from "./src/lib/runtime/security-headers";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@wasm-codecs/oxipng"],
  allowedDevOrigins: ["192.168.1.16"],
  experimental: {
    // Proxy clones request bodies. Match the artifact route's deliberate
    // end-to-end ceiling so valid profile ZIPs are not silently truncated.
    proxyClientMaxBodySize: 268_435_456,
  },
  async headers() {
    return [{ source: "/:path*", headers: [...APPLICATION_SECURITY_HEADERS] }];
  },
};

export default nextConfig;
