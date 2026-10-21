// Sonar check: an approximation of SonarQube for IDE's TypeScript/JavaScript rules, run from the command line
// so it sees every file (the VS Code extension only checks open files). Not part of the project's lint:
// it is installed in a temporary folder (see docs/SONAR_FIXES.md, "Set up the checker").
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import react from 'eslint-plugin-react';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Run from the repository root.
const ROOT = process.cwd();

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/generated/**', '**/.expo/**', '**/coverage/**', '**/*.d.ts'] },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: ROOT, ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '19.0' } },
    plugins: { sonarjs, unicorn, react, 'jsx-a11y': jsxA11y, '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      ...sonarjs.configs.recommended.rules,
      // Off: not shown by SonarQube for IDE in this project, or not worth changing (see the guide).
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/todo-tag': 'off',
      'sonarjs/fixme-tag': 'off',
      'sonarjs/no-commented-code': 'off',
      'sonarjs/prefer-specific-assertions': 'off',
      'sonarjs/assertions-in-tests': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/different-types-comparison': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-os-command-from-path': 'off',
      'sonarjs/void-use': 'off',
      'sonarjs/pseudo-random': 'off',
      // SonarQube rules that come from other plugins (Sonar rule id in the comment):
      'no-await-in-loop': 'error', // S9382
      '@typescript-eslint/prefer-optional-chain': 'error', // S6582
      '@typescript-eslint/no-base-to-string': 'error', // S6551
      '@typescript-eslint/require-await': 'error', // S7503
      '@typescript-eslint/no-floating-promises': 'error', // S9383
      '@typescript-eslint/no-deprecated': 'error', // S1874
      'unicorn/prefer-string-replace-all': 'error', // S7781
      'unicorn/prefer-at': 'error', // S7755
      'unicorn/prefer-structured-clone': 'error', // S7784
      'unicorn/numeric-separators-style': ['error', { onlyIfContainsSeparator: true }], // S7749
      'unicorn/prefer-code-point': 'error', // S7758
      'unicorn/no-useless-fallback-in-spread': 'error', // S7744
      'unicorn/prefer-string-raw': 'error', // S7780
      'unicorn/prefer-includes': 'error', // S7765
      'unicorn/prefer-set-has': 'error', // S7776
      'unicorn/error-message': 'error', // S7722
      'unicorn/prefer-single-call': 'error', // S7778
      'unicorn/prefer-number-properties': 'error', // S7773
      'unicorn/prefer-export-from': ['error', { ignoreUsedVariables: true }], // S7763
      'unicorn/prefer-array-some': 'error', // S7754
      'unicorn/no-array-reverse': 'error', // S4043
      'unicorn/prefer-node-protocol': 'error', // S7772
      'react/jsx-child-element-spacing': 'error', // S6772
      'react/no-array-index-key': 'error', // S6479
      'react/no-unstable-nested-components': ['error', { allowAsProps: true }], // S6478
      'react/hook-use-state': 'error', // S6754
      'react/no-unused-prop-types': 'error', // S6767
      'jsx-a11y/no-autofocus': 'error', // S9379
      'jsx-a11y/label-has-associated-control': 'error', // S6853
      'jsx-a11y/no-static-element-interactions': 'error', // S6848
      'jsx-a11y/mouse-events-have-key-events': 'error', // S1082
    },
  },
];
