export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  testMatch: ['/src/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testTimeout: 10000, // Increase timeout to 10 seconds
  testPathIgnorePatterns: ["/node_modules/", "/src/__tests__/mocks/server.ts"],
};
