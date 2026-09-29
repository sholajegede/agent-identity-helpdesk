// On Vercel the console is served under demos.sholajegede.com/agent-identity,
// so every page, asset and API route lives under that path. Locally the base
// path is empty and the console stays at localhost:3000.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  async redirects() {
    if (!basePath) return [];
    return [{source: '/', destination: basePath, basePath: false, permanent: false}];
  },
};

export default nextConfig;
