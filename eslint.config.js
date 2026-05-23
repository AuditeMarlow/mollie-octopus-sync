// Flat ESLint config (ESLint 9). Deliberately lean: type-checked recommended
// rules + React Hooks (the only React plugin that catches real bugs vs.
// stylistic preferences). Prettier owns formatting via eslint-config-prettier,
// which turns off any ESLint rule that would fight Prettier.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "src-tauri/target",
      "src-tauri/gen",
      "tests/stubs/**",
      "node_modules",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Catches `const foo: SomeType = ...` where `import { SomeType }`
      // would have done — important for tree-shaking and clarity.
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      // We deliberately ignore unused identifiers prefixed with `_`. The
      // built-in `no-unused-vars` doesn't understand TS so we use the TS one.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Config / non-source files get the looser default ruleset.
  {
    files: ["*.config.{js,ts}", "*.config.cjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
