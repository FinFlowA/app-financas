// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const securityConfig = require('eslint-plugin-security').configs.recommended;

module.exports = defineConfig([
  expoConfig,
  securityConfig,
  {
    ignores: ['dist*/**', '.codex-tmp-local-demo/**'],
  },
]);
