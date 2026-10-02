import globals from "globals";
import { config as baseConfig } from "./base.js";

/**
 * ESLint configuration for Node packages (core, pipeline, scripts).
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
