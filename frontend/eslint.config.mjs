import { createRequire } from "module";

const require = createRequire(import.meta.url);
const coreWebVitals = require("eslint-config-next/core-web-vitals");

export default [
  ...coreWebVitals,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "@next/next/no-img-element": "off",
      "@next/next/google-font-display": "off",
      "@next/next/no-page-custom-font": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: ["node_modules/", ".next/", "out/"],
  },
];
