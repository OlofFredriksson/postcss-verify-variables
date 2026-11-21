import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type InlineConfig, build, createServer } from "vite";
import { expect, test, vi } from "vitest";

// eslint-disable-next-line import-x/no-unresolved -- The package is built before integration tests.
import { verifyVars } from "postcss-verify-variables";
// eslint-disable-next-line import-x/no-unresolved -- The package is built before integration tests.
import { verifyVarsVite } from "postcss-verify-variables/vite";

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

type DevServer = Awaited<ReturnType<typeof createServer>>;

async function withDevServer(
    options: Parameters<typeof verifyVarsVite>[0],
    run: (server: DevServer, root: string) => Promise<void>,
    plugins: NonNullable<InlineConfig["plugins"]> = [],
): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "verify-variables-vite-"));
    let server: DevServer | undefined;
    try {
        await cp(fixtureRoot, root, { recursive: true });
        server = await createServer({
            ...baseConfig,
            root,
            server: { port: 0 },
            plugins: [verifyVarsVite(options), ...plugins],
        });
        await server.listen();
        await run(server, root);
    } finally {
        try {
            await server?.close();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
}

async function waitForDevCheck(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
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

test("Vite warns about undefined variables without failing development transforms or running a build", async () => {
    let builds = 0;
    await withDevServer(
        {},
        async (server, root) => {
            const warn = vi.spyOn(server.config.logger, "warn");
            const overlay = vi.spyOn(server.ws, "send");
            const result = await server.transformRequest("/invalid.css");
            expect(result?.code).toContain("var(--missing)");
            await waitForDevCheck();
            expect(warn).toHaveBeenCalled();
            expect(String(warn.mock.calls[0][0])).toContain(
                'CSS variable "--missing"',
            );
            const message = expect.stringContaining('CSS variable "--missing"');
            const error = expect.objectContaining({ message });
            const payload = expect.objectContaining({
                type: "error",
                err: error,
            });
            expect(overlay).toHaveBeenCalledWith(payload);

            warn.mockClear();
            overlay.mockClear();
            await writeFile(
                join(root, "variables.css"),
                ":root { --missing: red; }",
            );
            await server.transformRequest("/variables.css");
            await waitForDevCheck();
            expect(warn).not.toHaveBeenCalled();
            expect(overlay).not.toHaveBeenCalled();
        },
        [
            {
                name: "count-builds",
                apply: "build",
                buildStart() {
                    builds++;
                },
            },
        ],
    );
    expect(builds).toBe(0);
}, 30_000);

test.each([
    ["global", { global: ":root { --missing: red; }" }],
    ["ignore", { ignore: ["--missing"] }],
])("Vite honors %s for CSS in development", async (_name, options) => {
    await withDevServer(options, async (server) => {
        const warn = vi.spyOn(server.config.logger, "warn");
        const overlay = vi.spyOn(server.ws, "send");
        await server.transformRequest("/invalid.css");
        await waitForDevCheck();
        expect(warn).not.toHaveBeenCalled();
        expect(overlay).not.toHaveBeenCalled();
    });
});

test("Vite verifies a lazy stylesheet when it is loaded in development", async () => {
    await withDevServer({}, async (server, root) => {
        const warn = vi.spyOn(server.config.logger, "warn");
        await writeFile(
            join(root, "lazy.css"),
            ".lazy { color: var(--lazy-missing); }",
        );

        await server.transformRequest("/main.js");
        await waitForDevCheck();
        expect(warn).not.toHaveBeenCalled();

        await server.transformRequest("/lazy.js");
        await waitForDevCheck();
        expect(warn).toHaveBeenCalled();
        expect(String(warn.mock.calls[0][0])).toContain(
            'CSS variable "--lazy-missing"',
        );
    });
});
