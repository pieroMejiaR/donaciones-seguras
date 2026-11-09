import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/", "**/coverage/", "**/.aws-sam/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["api/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
]);
