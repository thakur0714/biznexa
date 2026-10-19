/**
 * htmlparser2 and its helpers (used by sanitize-html, D60) ship ES modules only. Node 22 loads them
 * from CommonJS at runtime, but Jest cannot, so they are compiled to CommonJS for tests.
 */
const ESM_ONLY = '(?:htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: String.raw`.*\.(spec|e2e-spec)\.ts$`,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
    [`/node_modules/(?:\\.pnpm/${ESM_ONLY}@[^/]+/node_modules/)?${ESM_ONLY}/.+\\.js$`]: ['ts-jest', { tsconfig: { allowJs: true, isolatedModules: true }, diagnostics: false }],
  },
  transformIgnorePatterns: [`/node_modules/(?!(?:\\.pnpm/)?${ESM_ONLY}[@/])`],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000,
  maxWorkers: 3,
  setupFiles: ['<rootDir>/test/setup-env.js'],
  // Coverage gate runs with `pnpm test` (jest --coverage) only, so a single-file `npx jest <file>` still passes.
  collectCoverageFrom: [
    '<rootDir>/src/applications/application-status.service.ts',
    '<rootDir>/src/coupons/coupons.service.ts',
    '<rootDir>/src/payments/refunds.service.ts',
    '<rootDir>/src/payments/payment-webhook.service.ts',
  ],
  coverageThreshold: {
    global: { lines: 80, statements: 80, functions: 80, branches: 80 },
  },
};
