import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type InlineConfig, build, createServer } from "vite";

// eslint-disable-next-line import-x/no-unresolved, import-x/order -- The package is built before integration tests.
import { verifyVars } from "postcss-verify-variables";
// eslint-disable-next-line import-x/no-unresolved, import-x/order -- The package is built before integration tests.
import { verifyVarsVite } from "postcss-verify-variables/vite";
import { expect, test } from "vitest";

const fixtureRoot = fileURLToPath(
    new URL("vite-boilerplate-app", import.meta.url),
);

const baseConfig = {
    configFile: false,
    root: fixtureRoot,
    logLevel: "silent",
} satisfies InlineConfig;

const buildConfig = {
    ...baseConfig,
    build: { write: false },
} satisfies InlineConfig;

function buildInvalid(
    options: Parameters<typeof verifyVarsVite>[0] = {},
): ReturnType<typeof build> {
    return build({
        ...buildConfig,
        build: {
            ...buildConfig.build,
            rolldownOptions: { input: join(fixtureRoot, "invalid.html") },
        },
        plugins: [verifyVarsVite(options)],
    });
}

function cssAssets(result: Awaited<ReturnType<typeof build>>): string[] {
    if (!("output" in result)) {
        throw new Error("Expected a Vite build output");
    }
    return result.output.flatMap((asset) =>
        asset.type === "asset" &&
        asset.fileName.endsWith(".css") &&
        typeof asset.source === "string"
            ? [asset.source]
            : [],
    );
}

test.each([false, true])(
    "Vite verifies variables across CSS output (cssCodeSplit: %s)",
    async (cssCodeSplit) => {
        const config = {
            ...buildConfig,
            build: { ...buildConfig.build, cssCodeSplit, minify: false },
            plugins: [verifyVarsVite()],
        } satisfies InlineConfig;

        const result = await build(config);
        const css = cssAssets(result);
        expect(css).toHaveLength(cssCodeSplit ? 2 : 1);
        expect(css.join("\n")).toContain("--theme-color: #123456");
        expect(css.join("\n")).toContain("var(--theme-color)");
    },
);

test("the PostCSS plugin rejects variables declared in another Vite CSS module", async () => {
    await expect(
        build({
            ...buildConfig,
            build: { ...buildConfig.build, cssCodeSplit: false },
            css: { postcss: { plugins: [verifyVars()] } },
        }),
    ).rejects.toThrow('CSS variable "--theme-color"');
});

test("Vite rejects an undefined variable in the generated CSS", async () => {
    await expect(buildInvalid()).rejects.toThrow('CSS variable "--missing"');
});

test.each([
    ["global", { global: ":root { --missing: red; }" }],
    ["ignore", { ignore: ["--missing"] }],
])("Vite honors %s for generated CSS", async (_name, options) => {
    const css = cssAssets(await buildInvalid(options));
    expect(css).toHaveLength(1);
    expect(css[0]).toContain("var(--missing)");
});

test.each([
    ["global", { global: ":root { --other: red; }" }],
    ["ignore", { ignore: ["--other"] }],
])("Vite does not allow unrelated variables in %s", async (_name, options) => {
    await expect(buildInvalid(options)).rejects.toThrow(
        'CSS variable "--missing"',
    );
});

test("Vite rejects multiple output configurations rather than checking them separately", async () => {
    await expect(
        build({
            ...buildConfig,
            build: {
                ...buildConfig.build,
                rolldownOptions: { output: [{}, {}] },
            },
            plugins: [verifyVarsVite()],
        }),
    ).rejects.toThrow(
        "does not support builds with multiple output configurations",
    );
});

test("Vite does not validate CSS or run a build in development", async () => {
    const root = await mkdtemp(join(tmpdir(), "verify-variables-vite-"));
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    let builds = 0;
    try {
        await cp(fixtureRoot, root, { recursive: true });
        server = await createServer({
            ...baseConfig,
            root,
            server: { port: 0 },
            plugins: [
                verifyVarsVite(),
                {
                    name: "count-builds",
                    apply: "build",
                    buildStart() {
                        builds++;
                    },
                },
            ],
        });
        await server.listen();
        const result = await server.transformRequest("/invalid.css");
        expect(result?.code).toContain("var(--missing)");
        expect(builds).toBe(0);
    } finally {
        try {
            await server?.close();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
}, 30_000);
