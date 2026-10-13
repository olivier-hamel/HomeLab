/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Keep the SDK available to the private operations checker as well as routes.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
  outputFileTracingIncludes: {
    "/api/moodle/*": [
      "./node_modules/@modelcontextprotocol/sdk/dist/esm/**/*.js",
      "./node_modules/zod/**/*.js",
    ],
  },
};

export default nextConfig;
