/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the tracing root to this project (stray lockfiles exist in parent dirs).
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
