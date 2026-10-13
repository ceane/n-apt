const esbuild = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    return {
      code: esbuild.transformSync(sourceText, {
        format: 'cjs',
        loader: 'js',
        platform: 'node',
        sourcefile: sourcePath,
        target: 'node22',
      }).code,
    };
  },
};
