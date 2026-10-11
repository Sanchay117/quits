// The video renders the app's own graph component (../app/src). Point every React import at this package's copy so
// there is exactly one React, and let webpack resolve the app's other dependencies (d3-force, viem) from app/.
import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias ?? {}),
      react: path.resolve("node_modules/react"),
      "react-dom": path.resolve("node_modules/react-dom"),
    },
  },
}));
