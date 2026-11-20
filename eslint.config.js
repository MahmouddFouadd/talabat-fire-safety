import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";
export default tseslint.config(
  { ignores: ["dist", "android", "ios", "dev-dist"] },
  { files: ["src/**/*.{ts,tsx}"], extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": hooks },
    rules: { ...hooks.configs.recommended.rules, "@typescript-eslint/no-explicit-any": "off", "react-hooks/exhaustive-deps": "off" } }
);
