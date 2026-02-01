/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/ts/setup.ts'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^react-router-dom$': '<rootDir>/node_modules/react-router-dom/dist/index.js',
    '^@n-apt/(.*)$': '<rootDir>/src/$1',
    '^@n-apt/components/(.*)$': '<rootDir>/src/components/$1',
    '^@n-apt/fft/(.*)$': '<rootDir>/src/fft/$1',
    '^@n-apt/waterfall/(.*)$': '<rootDir>/src/waterfall/$1',
    '^@n-apt/consts$': '<rootDir>/src/consts',
    '^@n-apt/hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^@n-apt/glb_models/(.*)$': '<rootDir>/src/glb_models/$1'
  },
  testMatch: [
    '<rootDir>/test/ts/**/*.test.ts',
    '<rootDir>/test/ts/**/*.test.tsx'
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/main.tsx',
    '!src/vite-env.d.ts'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        jsx: 'react-jsx'
      }
    }]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json']
};
