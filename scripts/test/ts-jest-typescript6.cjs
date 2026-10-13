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

const tsJestTransformer = require("ts-jest").default.createTransformer({
  compiler: "@typescript/typescript6",
  useESM: false,
  tsconfig: {
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    module: "CommonJS",
    jsx: "react-jsx",
  },
});

function rewriteViteMetaForCommonJs(code) {
  return code
    .replace(/import\.meta\.url/g, "__filename")
    .replace(/import\.meta\.env/g, "({})")
    .replace(/import\.meta\.hot/g, "undefined")
    .replace(/import\.meta/g, "({})");
}

module.exports = {
  process(sourceText, sourcePath, transformOptions) {
    const transformed = tsJestTransformer.process(
      sourceText,
      sourcePath,
      transformOptions,
    );
    if (typeof transformed === "string") {
      return rewriteViteMetaForCommonJs(transformed);
    }
    return {
      ...transformed,
      code: rewriteViteMetaForCommonJs(transformed.code),
    };
  },
  getCacheKey(...args) {
    return `${tsJestTransformer.getCacheKey(...args)}:vite-meta-cjs-v1`;
  },
};
