import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      ".next",
      "packages/contracts/src/generated/**",
    ],
  },
  ...tseslint.configs.recommended,
);
