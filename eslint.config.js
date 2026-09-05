/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import jsxA11yUntyped from "eslint-plugin-jsx-a11y";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

// eslint-plugin-jsx-a11y ships no types; narrow its shape once here instead of `any` leaking into every use below.
/** @type {{ flatConfigs: { recommended: { languageOptions: object; rules: Record<string, string | unknown[]> } } }} */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped module, narrowed by the JSDoc cast above
const jsxA11y = jsxA11yUntyped;

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

const generatedConfig = tseslint.config({
  files: ["src/db/database.types.ts"],
  rules: {
    "@typescript-eslint/no-redundant-type-constituents": "off",
    "@typescript-eslint/consistent-type-definitions": "off",
    "@typescript-eslint/consistent-indexed-object-style": "off",
  },
});

const jsxA11yWarnRules = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([rule, severity]) => [
    rule,
    Array.isArray(severity) ? ["warn", ...severity.slice(1)] : severity === "error" ? "warn" : severity,
  ]),
);

const jsxA11yConfig = tseslint.config({
  files: ["**/*.{jsx,tsx}"],
  plugins: { "jsx-a11y": jsxA11y },
  languageOptions: jsxA11y.flatConfigs.recommended.languageOptions,
  rules: jsxA11yWarnRules,
});

const astroConfig = tseslint.config({
  files: ["**/*.astro"],
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
    // astro-eslint-parser represents a top-level frontmatter `return` (Astro's idiomatic redirect/response
    // short-circuit) with no enclosing function node, which crashes this rule's parent traversal.
    "@typescript-eslint/no-misused-promises": "off",
  },
});

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  jsxA11yConfig,
  astroConfig,
  generatedConfig,
  eslintPluginPrettier,
);
