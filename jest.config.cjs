/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: [
    "<rootDir>/test/ts/setup.ts",
    "<rootDir>/jest.canvasSetup.cjs",
  ],
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^react-router-dom$": "<rootDir>/node_modules/react-router-dom/dist/index.js",
    "^@n-apt/consts$": "<rootDir>/src/ts/consts",
    "^@n-apt/md-preview/(.*)$": "<rootDir>/src/md-preview/$1",
    "^@n-apt/components/(.*)$": "<rootDir>/src/ts/components/$1",
    "^@n-apt/hooks/(.*)$": "<rootDir>/src/ts/hooks/$1",
    // Stub like other static assets: alias must not point at raw .svg or Jest parses XML as JS.
    "^@n-apt/public/(.*)$": "<rootDir>/test/ts/__mocks__/fileMock.cjs",
    "^@n-apt/(.*)$": "<rootDir>/src/ts/$1",
    "\\.(gif|jpg|jpeg|png|svg|webp)$": "<rootDir>/test/ts/__mocks__/fileMock.cjs",
    "\\.css$": "<rootDir>/test/ts/__mocks__/styleMock.cjs",
  },
  testMatch: [
    "<rootDir>/test/ts/**/*.test.ts", 
    "<rootDir>/test/ts/**/*.test.tsx",
    "<rootDir>/test/integration/**/*.test.ts",
    "<rootDir>/test/integration/**/*.test.tsx"
  ],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/main.tsx",
    "!src/vite-env.d.ts",
    "!src/workers/**/*", // Skip workers from coverage - run in separate contexts
    "!src/**/*stories.tsx", // Skip Storybook stories - documentation only
    "!src/encrypted-modules/**/*", // Skip encrypted/temporary modules
  ],
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 24,
      lines: 33,
      statements: 33,
    },
    // Key utilities should have high coverage
    'src/ts/utils/frequency.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/ts/utils/centerFrequency.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/ts/utils/webgpu.ts': {
      branches: 40,
      functions: 50,
      lines: 70,
      statements: 70,
    },
    'src/ts/utils/gpuMemoryManager.ts': {
      branches: 58,
      functions: 75,
      lines: 70,
      statements: 70,
    },
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          jsx: "react-jsx",
        },
      },
    ],
    "\\.wgsl$": "jest-transform-stub"
  },
  transformIgnorePatterns: ["node_modules/(?!(.*\\.mjs$|@chenglou/pretext))"],
  modulePathIgnorePatterns: ["<rootDir>/.shared-worktree-cache/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
