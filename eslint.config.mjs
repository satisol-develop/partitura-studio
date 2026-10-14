import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Next 16 ya publica presets en formato "flat config", así que no hace falta
 * el adaptador FlatCompat (que además revienta con estructuras circulares).
 */
const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
