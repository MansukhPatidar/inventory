import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const isProd = process.env.NODE_ENV === "production";

const withPWA = withPWAInit({
  dest: "public",
  disable: !isProd,
});

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/inventory" : "",
  assetPrefix: isProd ? "/inventory/" : "",
  images: {
    unoptimized: true,
  },
  turbopack: {},
};

export default withPWA(nextConfig);
