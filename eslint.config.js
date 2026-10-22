import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'dist-e2e-*/', 'node_modules/', 'prototypes/', 'tools/', 'notebook/', 'temp/', 'test-results/', 'playwright-report/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  // A leading underscore marks a deliberately unused name (kept for a stable signature or stripped on purpose).
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }] } },
);
