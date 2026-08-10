import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
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
// Generated upgrade-backup scripts are source generators, not production runtime.
// Keep them lintable while allowing their intentional CommonJS construction.
{
  files: ["scripts/generate-upgrade57-backup.ts", "scripts/generate-upgrade58-backup.ts"],
  rules: {
    "@typescript-eslint/no-require-imports": "off",
  },
},
// These two modules intentionally use lazy CommonJS loading to break a circular
// dependency with TOOL_REGISTRY. Replacing it with a static import would recreate
// the initialization cycle they were specifically designed to avoid.
{
  files: ["src/lib/subagents.ts", "src/lib/tool-protection.ts"],
  rules: {
    "@typescript-eslint/no-require-imports": "off",
  },
},
{
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "scripts/**/*.cjs", "scripts/**/*.js"]
}];

export default eslintConfig;
