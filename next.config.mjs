// On Vercel the console is served under sholajegede.com/demos/agent-identity,
// so every page, asset and API route lives under that path. Locally the base
// path is empty and the console stays at localhost:3000.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  async redirects() {
    if (!basePath) return [];
    // A visit to this app's own domain goes to its public address on sholajegede.com.
    return [{source: '/', destination: `https://sholajegede.com${basePath}`, basePath: false, permanent: true}];
  },
};

export default nextConfig;
