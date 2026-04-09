import type { NextConfig } from "next";

/**
 * Rewrite /api/agent/* to the local ElizaOS agent server. In production (the
 * single Docker container), the agent lives on localhost:AGENT_PORT and is
 * only exposed to the Next.js process. Nosana only publishes port 3000.
 */
const agentPort = process.env.AGENT_PORT || "4111";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/agent/:path*",
        destination: `http://127.0.0.1:${agentPort}/:path*`,
      },
    ];
  },
};

export default nextConfig;
