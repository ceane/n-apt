const typescript6 = require("@typescript/typescript6");

// ts-jest still has a few internal imports of "typescript" even when its
// compiler option points at another package. Keep those imports on the TS 6
// compatibility API for Jest without changing the repo-wide TypeScript 7 install.
require.cache[require.resolve("typescript")] = {
  exports: typescript6,
  id: require.resolve("typescript"),
  filename: require.resolve("@typescript/typescript6"),
  loaded: true,
};

module.exports = require("ts-jest").default.createTransformer({
  compiler: "@typescript/typescript6",
  useESM: true,
  tsconfig: {
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    jsx: "react-jsx",
  },
});
