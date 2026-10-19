import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // The domain core is pure TypeScript: no framework, no database, no app code (see CLAUDE.md).
    files: ["domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["react", "react-*", "next", "next/*", "@supabase/*", "server-only"], message: "domain/ must stay framework-free." },
          { group: ["@/app/*", "@/lib/*", "@/components/*", "../app/*", "../lib/*", "../components/*"], message: "domain/ must not import app code." },
        ],
      }],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "supabase/seed.sql",
    ],
  },
];

export default eslintConfig;
