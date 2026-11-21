import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type InlineConfig, build, createServer, normalizePath } from "vite";
// eslint-disable-next-line import-x/no-extraneous-dependencies -- Provided by the Vue sandbox workspace.
import vue from "@vitejs/plugin-vue";
import { type MockInstance, expect, test, vi } from "vitest";

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

interface DevContext {
    server: DevServer;
    root: string;
    warn: MockInstance<DevServer["config"]["logger"]["warn"]>;
    overlay: MockInstance<DevServer["ws"]["send"]>;
    connect: () => Promise<{ socket: WebSocket; messages: unknown[] }>;
}

function createDevContext(
    server: DevServer,
    root: string,
    sockets: Set<WebSocket>,
): DevContext {
    return {
        server,
        root,
        warn: vi.spyOn(server.config.logger, "warn"),
        overlay: vi.spyOn(server.ws, "send"),
        connect: () => connectDevClient(server, sockets),
    };
}

async function withDevServer(
    options: Parameters<typeof verifyVarsVite>[0],
    run: (context: DevContext) => Promise<void>,
    plugins: NonNullable<InlineConfig["plugins"]> = [],
): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), "verify-variables-vite-"));
    const sockets = new Set<WebSocket>();
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
        await run(createDevContext(server, await realpath(root), sockets));
    } finally {
        try {
            for (const socket of sockets) {
                socket.close();
            }
            await server?.close();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
}

async function waitForDevCheck(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
}

async function waitForWarning(warn: DevContext["warn"]): Promise<void> {
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { interval: 10 });
}

async function loadVariable(
    server: DevServer,
    root: string,
    name: string,
): Promise<void> {
    await writeFile(join(root, "variables.css"), `:root { ${name}: red; }`);
    await server.transformRequest("/variables.css");
}

async function connectDevClient(
    server: DevServer,
    sockets: Set<WebSocket>,
): Promise<{ socket: WebSocket; messages: unknown[] }> {
    const url = server.resolvedUrls?.local[0];
    if (!url) {
        throw new Error("Vite did not provide a local URL");
    }

    const socket = new WebSocket(url.replace(/^http/, "ws"), "vite-hmr");
    sockets.add(socket);
    socket.addEventListener("close", () => sockets.delete(socket), {
        once: true,
    });
    const messages: unknown[] = [];
    socket.addEventListener("message", (event) => {
        messages.push(JSON.parse(String(event.data)) as unknown);
    });
    await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
            "error",
            () => reject(new Error("WebSocket connection failed")),
            {
                once: true,
            },
        );
    });
    return { socket, messages };
}

function expectOverlayError(
    overlay: DevContext["overlay"],
    error: unknown,
): void {
    expect(overlay).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", err: error }),
    );
}

async function expectCleanClientConnect(
    connect: DevContext["connect"],
    unexpected: unknown,
): Promise<void> {
    const client = await connect();
    await vi.waitFor(() => {
        expect(client.messages).toContainEqual({ type: "connected" });
    });
    await waitForDevCheck();
    expect(client.messages).not.toContainEqual(unexpected);
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

test("Vite reports the generated CSS asset and position in build errors", async () => {
    await expect(buildInvalid()).rejects.toMatchObject({
        message: expect.stringMatching(
            /assets\/[^:\s]+\.css:1:\d+: CSS variable "--missing"/,
        ),
    });
});

test("Vite locates errors in later assets while checking variables across assets", async () => {
    await expect(
        build({
            ...buildConfig,
            plugins: [
                verifyVarsVite(),
                {
                    name: "test-css-assets",
                    generateBundle() {
                        this.emitFile({
                            type: "asset",
                            fileName: "first-extra.css",
                            source: ".first { color: var(--extra); }\n",
                        });
                        this.emitFile({
                            type: "asset",
                            fileName: "second-extra.css",
                            source: ":root { --extra: red; }\n.second { color: var(--absent); }",
                        });
                    },
                },
            ],
        }),
    ).rejects.toMatchObject({
        message: expect.stringContaining(
            'second-extra.css:2:22: CSS variable "--absent"',
        ),
    });
});

test("Vite CLI reports a verification error without PostCSS stack frames", async () => {
    const root = await mkdtemp(join(tmpdir(), "verify-variables-cli-"));
    try {
        const config = join(root, "vite.config.mjs");
        const plugin = import.meta.resolve("postcss-verify-variables/vite");
        await writeFile(
            config,
            `import { verifyVarsVite } from ${JSON.stringify(plugin)};
export default {
    plugins: [verifyVarsVite()],
    build: { write: false, rolldownOptions: { input: ${JSON.stringify(join(fixtureRoot, "invalid.html"))} } }
};`,
        );
        const vite = fileURLToPath(
            new URL("../../bin/vite.js", import.meta.resolve("vite")),
        );
        const result = spawnSync(
            process.execPath,
            [vite, "build", fixtureRoot, "--config", config],
            { encoding: "utf8" },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr.match(/CSS variable "--missing"/g)).toHaveLength(
            1,
        );
        expect(result.stderr).toContain("Declare the variable");
        expect(result.stderr).not.toContain("at Input.error");
        expect(result.stderr).not.toContain("at LazyResult");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}, 30_000);

test("Vite preserves unrelated CSS syntax errors", async () => {
    await expect(buildInvalid({ global: "a {" })).rejects.toThrow(
        "Unclosed block",
    );
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
        async ({ server, root, warn, overlay, connect }) => {
            await connect();
            const result = await server.transformRequest("/invalid.css");
            expect(result?.code).toContain("var(--missing)");
            await waitForWarning(warn);
            expect(String(warn.mock.calls[0][0])).toContain(
                'CSS variable "--missing"',
            );
            const message = expect.stringContaining('CSS variable "--missing"');
            const file = normalizePath(join(root, "invalid.css"));
            const loc = { file, line: 2, column: 16 };
            const error = expect.objectContaining({ message, id: file, loc });
            expectOverlayError(overlay, error);

            warn.mockClear();
            overlay.mockClear();
            await loadVariable(server, root, "--missing");
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

test("Vite verifies compiled Sass, including imported partials, with other stylesheets", async () => {
    await withDevServer(
        {},
        async ({ server, root, warn, overlay, connect }) => {
            await connect();
            await writeFile(join(root, "entry.scss"), '@use "partial";\n');
            await writeFile(
                join(root, "_partial.scss"),
                ".example { color: var(--sass-missing); }\n",
            );
            const result = await server.transformRequest("/entry.scss");
            expect(result?.code).toContain("var(--sass-missing)");
            await waitForWarning(warn);
            expect(String(warn.mock.calls[0][0])).toContain(
                'CSS variable "--sass-missing"',
            );
            const error = expect.objectContaining({
                id: normalizePath(join(root, "entry.scss")),
                loc: undefined,
                message: expect.stringContaining("(processed CSS:2:14)"),
            });
            expectOverlayError(overlay, error);

            await loadVariable(server, root, "--sass-missing");
            await waitForDevCheck();
            await expectCleanClientConnect(
                connect,
                expect.objectContaining({ type: "error" }),
            );
        },
    );
}, 30_000);

test("Vite rechecks compiled Sass after an imported partial changes", async () => {
    await withDevServer({}, async ({ server, root, warn, connect }) => {
        await connect();
        const partial = join(root, "_partial.scss");
        await writeFile(join(root, "entry.scss"), '@use "partial";\n');
        await writeFile(partial, ".example { color: red; }\n");
        await server.transformRequest("/entry.scss");
        await waitForDevCheck();
        expect(warn).not.toHaveBeenCalled();

        await writeFile(partial, ".example { color: var(--changed); }\n");
        await vi.waitFor(async () => {
            const result = await server.transformRequest("/entry.scss");
            expect(result?.code).toContain("var(--changed)");
        });
        await vi.waitFor(
            () => {
                expect(warn).toHaveBeenCalledWith(
                    expect.stringContaining('CSS variable "--changed"'),
                );
            },
            { interval: 10 },
        );

        await writeFile(partial, ".example { color: red; }\n");
        await vi.waitFor(async () => {
            const result = await server.transformRequest("/entry.scss");
            expect(result?.code).not.toContain("var(--changed)");
        });
        await waitForDevCheck();
        await expectCleanClientConnect(
            connect,
            expect.objectContaining({ type: "error" }),
        );
    });
}, 30_000);

test("Vite does not verify CSS imported as raw text", async () => {
    await withDevServer({}, async ({ server, warn }) => {
        const result = await server.transformRequest("/invalid.css?raw");
        expect(result?.code).toContain("var(--missing)");
        await waitForDevCheck();
        expect(warn).not.toHaveBeenCalled();
    });
});

test("Vite verifies multiple Vue style blocks independently", async () => {
    await withDevServer(
        {},
        async ({ server, root, warn, overlay, connect }) => {
            await connect();
            await writeFile(
                join(root, "component.vue"),
                `<template><div /></template>
<style>.first { color: var(--vue-missing); }</style>
<style>.second { color: red; }</style>`,
            );
            await server.transformRequest(
                "/component.vue?vue&type=style&index=0&lang.css",
            );
            await server.transformRequest(
                "/component.vue?vue&type=style&index=1&lang.css",
            );
            await waitForWarning(warn);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('CSS variable "--vue-missing"'),
            );
            expectOverlayError(
                overlay,
                expect.objectContaining({
                    id: expect.stringContaining(
                        "component.vue?vue&type=style&index=0",
                    ),
                    loc: undefined,
                    message: expect.stringContaining("(processed CSS:"),
                }),
            );

            warn.mockClear();
            server.watcher.emit("unlink", join(root, "component.vue"));
            await server.transformRequest("/invalid.css");
            await waitForWarning(warn);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('CSS variable "--missing"'),
            );
        },
        [vue()],
    );
});

test("Vite checks Vue style blocks together", async () => {
    await withDevServer(
        {},
        async ({ server, root, warn }) => {
            await writeFile(
                join(root, "component.vue"),
                `<template><div /></template>
<style>.first { color: var(--vue-color); }</style>
<style>:root { --vue-color: red; }</style>`,
            );
            await server.transformRequest(
                "/component.vue?vue&type=style&index=1&lang.css",
            );
            await server.transformRequest(
                "/component.vue?vue&type=style&index=0&lang.css",
            );
            await waitForDevCheck();
            expect(warn).not.toHaveBeenCalled();
        },
        [vue()],
    );
});

test("Vite removes styles when their directory is unlinked", async () => {
    await withDevServer({}, async ({ server, root, warn }) => {
        await mkdir(join(root, "sub"));
        await writeFile(
            join(root, "sub", "variables.css"),
            ":root { --missing: red; }",
        );
        await server.transformRequest("/sub/variables.css");
        await server.transformRequest("/invalid.css");
        await waitForDevCheck();
        expect(warn).not.toHaveBeenCalled();

        server.watcher.emit("unlinkDir", join(root, "sub"));
        await waitForWarning(warn);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('CSS variable "--missing"'),
        );
    });
});

test("Vite cancels pending verification when a middleware server closes", async () => {
    const server = await createServer({
        ...baseConfig,
        server: { middlewareMode: true },
        plugins: [verifyVarsVite()],
    });
    const warn = vi.spyOn(server.config.logger, "warn");
    try {
        await server.transformRequest("/invalid.css");
    } finally {
        await server.close();
    }
    await waitForDevCheck();
    expect(warn).not.toHaveBeenCalled();
});

test.each([
    ["without a final newline", ".first { color: red; }"],
    ["with a final newline", ".first { color: red; }\n"],
    ["with CRLF newlines", ".first {\r\n  color: red;\r\n}\r\n"],
])("Vite reports the source location after CSS %s", async (_name, first) => {
    await withDevServer(
        {},
        async ({ server, root, warn, overlay, connect }) => {
            await connect();
            await writeFile(join(root, "first.css"), first);
            const second = normalizePath(join(root, "second.css"));
            await writeFile(
                second,
                ".second {\n    color: var(--missing);\n}\n",
            );

            await server.transformRequest("/first.css");
            await server.transformRequest("/second.css");
            await waitForWarning(warn);

            expect(String(warn.mock.calls[0][0])).toContain(`${second}:2:16:`);
            const loc = { file: second, line: 2, column: 16 };
            const err = expect.objectContaining({ id: second, loc });
            expectOverlayError(overlay, err);
        },
    );
});

test("Vite replays active CSS errors to reconnecting clients until fixed", async () => {
    await withDevServer({}, async ({ server, root, warn, connect }) => {
        const initial = await connect();
        await server.transformRequest("/invalid.css");
        await waitForWarning(warn);
        await vi.waitFor(() => {
            expect(initial.messages).toContainEqual(
                expect.objectContaining({ type: "error" }),
            );
        });
        initial.socket.close();

        const reconnected = await connect();
        const error = expect.objectContaining({
            message: expect.stringContaining('CSS variable "--missing"'),
            id: normalizePath(join(root, "invalid.css")),
        });
        const payload = expect.objectContaining({ type: "error", err: error });
        await vi.waitFor(() => {
            expect(reconnected.messages).toContainEqual(payload);
        });
        reconnected.socket.close();

        await loadVariable(server, root, "--missing");
        await waitForDevCheck();

        await expectCleanClientConnect(connect, payload);
    });
}, 30_000);

test("Vite does not replay a corrected error reported before any client connects", async () => {
    await withDevServer({}, async ({ server, root, warn, connect }) => {
        await server.transformRequest("/invalid.css");
        await waitForWarning(warn);
        await loadVariable(server, root, "--missing");
        await waitForDevCheck();

        await expectCleanClientConnect(
            connect,
            expect.objectContaining({ type: "error" }),
        );
    });
}, 30_000);

test.each([
    ["global", { global: ":root { --missing: red; }" }],
    ["ignore", { ignore: ["--missing"] }],
])("Vite honors %s for CSS in development", async (_name, options) => {
    await withDevServer(options, async ({ server, warn, overlay }) => {
        await server.transformRequest("/invalid.css");
        await waitForDevCheck();
        expect(warn).not.toHaveBeenCalled();
        expect(overlay).not.toHaveBeenCalled();
    });
});

test("Vite verifies a lazy stylesheet when it is loaded in development", async () => {
    await withDevServer({}, async ({ server, root, warn }) => {
        await writeFile(
            join(root, "lazy.css"),
            ".lazy { color: var(--lazy-missing); }",
        );

        await server.transformRequest("/main.js");
        await waitForDevCheck();
        expect(warn).not.toHaveBeenCalled();

        await server.transformRequest("/lazy.js");
        await waitForWarning(warn);
        expect(String(warn.mock.calls[0][0])).toContain(
            'CSS variable "--lazy-missing"',
        );
    });
});
