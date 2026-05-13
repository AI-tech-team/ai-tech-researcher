import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/ai-tech-researcher',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
