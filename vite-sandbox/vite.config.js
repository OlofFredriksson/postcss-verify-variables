import { defineConfig } from "vite";

import { verifyVarsVite } from "postcss-verify-variables/vite";

export default defineConfig({
    plugins: [verifyVarsVite()],
});
