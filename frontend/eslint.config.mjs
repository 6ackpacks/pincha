import { createRequire } from "module";

const require = createRequire(import.meta.url);
const coreWebVitals = require("eslint-config-next/core-web-vitals");

export default [
  ...coreWebVitals,
  {
    rules: {
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-compiler/react-compiler": "warn",
    },
  },
  {
    ignores: ["node_modules/", ".next/", "out/"],
  },
];
