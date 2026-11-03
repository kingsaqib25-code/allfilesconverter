/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pptxgenjs dynamically imports node:fs / node:https only in Node-only
      // code paths (file writing, remote fetch) — never hit in the browser.
      // Stub them so the browser bundle builds.
      const webpack = require('webpack');
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^node:(fs|https)$/ })
      );
    }
    return config;
  },
};

module.exports = nextConfig;
