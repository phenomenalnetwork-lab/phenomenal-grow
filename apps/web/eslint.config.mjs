import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "eslint-config-next";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "out/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  {
    rules: {
      // Tech debt: server actions/components use `any` for API payloads.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "react/no-unescaped-entities": "off",
    },
  },
);
