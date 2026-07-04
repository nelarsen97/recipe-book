// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'coverage/*', 'android/*', 'ios/*'],
  },
  {
    // Tests use require() on purpose: jest.mock factories and re-requiring
    // modules after jest.resetModules() to reset module-scoped state.
    files: ['**/__tests__/**', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
