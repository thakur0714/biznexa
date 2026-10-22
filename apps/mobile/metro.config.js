// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The workspace packages (@biznexa/api-client, @biznexa/config) only declare "exports", not "main".
config.resolver.unstable_enablePackageExports = true;

// Some dependencies (e.g. @expo/vector-icons) don't declare react as a peer, so pnpm hands them the
// monorepo's React 19 (web) and the tab icons crash. Always resolve react from this app (React 18).
const appEntry = path.join(__dirname, 'index.js');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return context.resolveRequest({ ...context, originModulePath: appEntry }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
