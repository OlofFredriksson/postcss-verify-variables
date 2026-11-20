import defaultConfig, { defineConfig } from "@forsakringskassan/eslint-config";
import typescriptConfig from "@forsakringskassan/eslint-config-typescript";
import vueConfig from "@forsakringskassan/eslint-config-vue";

export default [
    defineConfig({
        name: "Ignored files",
        ignores: [
            "**/coverage/**",
            "**/dist/**",
            "**/node_modules/**",
            "**/temp/**",
        ],
    }),

    ...defaultConfig,
    typescriptConfig(),
    vueConfig(),

    {
        name: "Cypress test globals",
        files: ["vite-sandbox/cypress/**/*.cy.js"],
        languageOptions: {
            globals: {
                cy: "readonly",
                describe: "readonly",
                it: "readonly",
            },
        },
    },

    {
        name: "Node Native test runner requires file extensions",
        files: ["**/*.ts"],
        rules: { "import-x/extensions": "off" },
    },

    {
        name: "Integration build imports generated package",
        files: ["src/int-test/build.mjs", "src/int-test/vite.test.ts"],
        linterOptions: { reportUnusedDisableDirectives: "off" },
    },
];
