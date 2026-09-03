//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  ...tanstackConfig,
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
    },
  },
  {
    // shadcn writes these, and `shadcn add` rewrites them. Reformatting their
    // imports to suit eslint 10 only creates a diff to re-resolve every update.
    files: ["src/components/ui/*.tsx", "src/lib/utils.ts"],
    rules: { "import/consistent-type-specifier-style": "off" },
  },
  {
    ignores: ["eslint.config.js", ".prettierrc"],
  },
]
