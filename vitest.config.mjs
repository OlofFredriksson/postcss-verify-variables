import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
    test:
        mode === "integration"
            ? {
                  include: configDefaults.include.map(
                      (pattern) => `src/int-test/${pattern}`,
                  ),
                  globalSetup: ["src/int-test/global-setup.mjs"],
              }
            : {
                  exclude: [...configDefaults.exclude, "src/int-test/**"],
              },
}));
