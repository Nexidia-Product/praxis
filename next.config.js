/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // resend depends on Node's stream and crypto modules. Marking it as
  // an external package keeps it out of the Edge bundle (where those
  // modules don't resolve) and loads it via require() at runtime on
  // the Node server. The route that uses it already runs on the Node
  // runtime; this is belt-and-suspenders to keep the bundler happy.
  serverExternalPackages: ["resend"],
};

module.exports = nextConfig;
