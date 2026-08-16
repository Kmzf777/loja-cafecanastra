/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ha package-lock.json na raiz do repositorio e em frontend/. Sem isto o Next
  // infere a raiz errada e o tracing de deploy pode empacotar do lugar errado.
  outputFileTracingRoot: import.meta.dirname,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
};

export default nextConfig;
