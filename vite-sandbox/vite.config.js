import { defineConfig } from "vite";

import vue from "@vitejs/plugin-vue";
import { verifyVarsVite } from "postcss-verify-variables/vite";

export default defineConfig({
    plugins: [vue(), verifyVarsVite()],
});
