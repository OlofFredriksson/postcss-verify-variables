import { existsSync } from "node:fs";
import {
    appendFile,
    copyFile,
    cp,
    mkdir,
    mkdtemp,
    readdir,
    rm,
    stat,
    symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ViteDevServer, createServer } from "vite";
import { type Browser, type Page, launch } from "puppeteer";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const sandbox = fileURLToPath(new URL("../../vite-sandbox", import.meta.url));
const modules = fileURLToPath(new URL("../../node_modules", import.meta.url));
const setupTimeout = 60_000;
const pageTimeout = 15_000;

let root: string | undefined;
let sandboxRoot: string;
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let page: Page;

async function linkModules(source: string, target: string): Promise<void> {
    await mkdir(target, { recursive: true });
    if (!existsSync(source)) {
        return;
    }

    const entries = await readdir(source);
    for (const entry of entries) {
        if (entry === ".vite" || entry === ".vite-temp") {
            continue;
        }
        const from = join(source, entry);
        const to = join(target, entry);
        const info = await stat(from);
        const type = info.isDirectory() ? "junction" : "file";
        await symlink(from, to, type);
    }
}

async function createSandbox(): Promise<void> {
    root = await mkdtemp(join(tmpdir(), "verify-variables-sandbox-"));
    sandboxRoot = join(root, "vite-sandbox");
    await cp(sandbox, sandboxRoot, {
        recursive: true,
        filter: (source) => source !== join(sandbox, "node_modules"),
    });
    await copyFile(
        fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
        join(root, "tsconfig.json"),
    );
    await symlink(modules, join(root, "node_modules"), "junction");
    await linkModules(
        join(sandbox, "node_modules"),
        join(sandboxRoot, "node_modules"),
    );
}

async function startSandbox(): Promise<void> {
    server = await createServer({
        root: sandboxRoot,
        server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) {
        throw new Error("Vite did not provide a local URL");
    }
    browser = await launch({
        headless: true,
        args: ["--no-sandbox"],
    });
    page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });
}

async function stopSandbox(): Promise<void> {
    try {
        await browser?.close();
    } finally {
        try {
            await server?.close();
        } finally {
            if (root) {
                await rm(root, { recursive: true, force: true });
            }
            root = undefined;
            server = undefined;
            browser = undefined;
        }
    }
}

async function appendCss(css: string): Promise<void> {
    await appendFile(join(sandboxRoot, "src/style.css"), `\n${css}\n`);
}

beforeEach(createSandbox, setupTimeout);

afterEach(stopSandbox, setupTimeout);

describe("with valid CSS", () => {
    beforeEach(startSandbox, setupTimeout);

    test(
        "the Vite sandbox renders a button",
        async () => {
            expect(
                await page.waitForSelector("button", { timeout: pageTimeout }),
            ).not.toBeNull();
            expect(await page.$("vite-error-overlay")).toBeNull();
        },
        setupTimeout,
    );
});

describe("with an undefined CSS variable", () => {
    beforeEach(() =>
        appendCss("main { color: var(--undefined-for-overlay); }"),
    );
    beforeEach(startSandbox, setupTimeout);

    test(
        "Vite displays the variable error in its overlay",
        async () => {
            const overlay = await page.waitForSelector("vite-error-overlay", {
                visible: true,
                timeout: pageTimeout,
            });
            expect(overlay).not.toBeNull();
            const message = await overlay?.evaluate(
                (element) => element.shadowRoot?.textContent,
            );
            expect(message).toContain('CSS variable "--undefined-for-overlay"');
            expect(message).toContain("verify-variables:development");
        },
        setupTimeout,
    );
});
