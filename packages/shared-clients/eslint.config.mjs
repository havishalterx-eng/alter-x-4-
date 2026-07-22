import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", ".next"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["packages/shared-clients/src/provider-types.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
