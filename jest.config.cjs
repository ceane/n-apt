const scopedFrontendRoots = {
  app: "src/ts/app",
  ui: "src/ts/shared/ui",
  math: "src/ts/shared/math",
  layout: "src/ts/shared/layout",
  spectrum: "src/ts/features/spectrum",
  demodulation: "src/ts/features/demodulation",
  capture: "src/ts/features/capture",
  transmit: "src/ts/features/transmit",
  maps: "src/ts/features/maps",
  learn: "src/ts/features/learn",
  "three-d": "src/ts/features/three-d",
  "draw-signal": "src/ts/features/draw-signal",
  classification: "src/ts/features/classification",
  settings: "src/ts/features/settings",
  "sdr-test": "src/ts/features/sdr-test",
  agents: "src/ts/agents",
  cli: "src/ts/cli",
  consts: "src/ts/consts",
  crypto: "src/ts/crypto",
  redux: "src/ts/redux",
  types: "src/ts/types",
  validation: "src/ts/validation",
  workers: "src/ts/workers",
  shaders: "src/ts/shaders",
};

const scopedFrontendMappers = Object.fromEntries(
  Object.entries(scopedFrontendRoots).flatMap(([namespace, root]) => [
    [`^@n-apt/${namespace}$`, `<rootDir>/${root}`],
    [`^@n-apt/${namespace}/(.*)$`, `<rootDir>/${root}/$1`],
  ]),
);

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
    "^react-router$": "<rootDir>/test/ts/__mocks__/react-router.cjs",
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@n-apt/consts$": "<rootDir>/src/ts/consts",
    "^@n-apt/app-article/utils/hmr$": "<rootDir>/test/ts/__mocks__/mdPreviewHmrMock.cjs",
    "^@n-apt/app-article$": "<rootDir>/src/app-article",
    "^@n-apt/app-article/(.*)$": "<rootDir>/src/app-article/$1",
    "^@n-apt/app-game$": "<rootDir>/src/app-game",
    "^@n-apt/app-game/(.*)$": "<rootDir>/src/app-game/$1",
    "^@n-apt/app-legal$": "<rootDir>/src/app-legal",
    "^@n-apt/app-legal/(.*)$": "<rootDir>/src/app-legal/$1",
    ...scopedFrontendMappers,
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
  testPathIgnorePatterns: [
    "/node_modules/",
    "/.shared-worktree-cache/"
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
    'src/ts/shared/math/frequency.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/ts/shared/math/centerFrequency.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    'src/ts/app/infrastructure/visualization/webgpu.ts': {
      branches: 40,
      functions: 50,
      lines: 70,
      statements: 70,
    },
    'src/ts/app/infrastructure/visualization/gpuMemoryManager.ts': {
      branches: 58,
      functions: 75,
      lines: 70,
      statements: 70,
    },
  },
  transform: {
    "^.+\\.(ts|tsx)$": "<rootDir>/scripts/test/ts-jest-typescript6.cjs",
    "\\.wgsl$": "jest-transform-stub"
  },
  transformIgnorePatterns: ["node_modules/(?!(.*\\.mjs$|@chenglou/pretext))"],
  modulePathIgnorePatterns: ["<rootDir>/.shared-worktree-cache/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
