// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Imports are written as `@/lib/...`, which is a tsconfig path rather than a
    // folder on disk. Without the TypeScript resolver every one of them reads as
    // a missing module.
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
  },
  {
    ignores: ['dist/*'],
  },
]);
