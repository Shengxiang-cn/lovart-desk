import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    devtoolSegmentExplorer: false
  },
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
