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
    "^@n-apt/(.*)$": "<rootDir>/src/ts/$1",
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
    "!src/workers/**/*", // Skip workers from coverage for now
  ],
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
  },
  transformIgnorePatterns: ["node_modules/(?!(.*\\.mjs$))"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
