import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
},
// Generated backup/source-builder scripts intentionally emit CommonJS code.
{
  files: ["scripts/generate-upgrade57-backup.ts", "scripts/generate-upgrade58-backup.ts"],
  rules: { "@typescript-eslint/no-require-imports": "off" },
},
// These modules intentionally use lazy CommonJS loading to avoid runtime
// initialization cycles with the tool registry/protection layer.
{
  files: ["src/lib/subagents.ts", "src/lib/tool-protection.ts"],
  rules: { "@typescript-eslint/no-require-imports": "off" },
},
// Legacy authentication/approval modules retain one node:crypto require for
// compatibility; the rule exclusion is file-scoped and does not affect new code.
{
  files: ["src/lib/auth.ts", "src/lib/user-approval.ts"],
  rules: { "@typescript-eslint/no-require-imports": "off" },
},
{
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "scripts/**/*.cjs", "scripts/**/*.js"]
}];

export default eslintConfig;
