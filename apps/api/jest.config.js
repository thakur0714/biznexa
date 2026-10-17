/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: String.raw`.*\.(spec|e2e-spec)\.ts$`,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000,
  maxWorkers: 3,
  setupFiles: ['<rootDir>/test/setup-env.js'],
};
