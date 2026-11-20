import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

function runBuild(name: string): Promise<{ stdout: string; stderr: string }> {
    const run = promisify(execFile);
    const build = fileURLToPath(new URL("build.mjs", import.meta.url));
    const fixture = fileURLToPath(
        new URL(`sass/${name}.scss`, import.meta.url),
    );
    return run(process.execPath, [build, fixture]);
}

test("compiles Sass modules and verifies the resulting CSS", async () => {
    const { stdout } = await runBuild("valid");

    expect(stdout).toMatch(/--text-color:\s*#123456/);
    expect(stdout).toMatch(/\.button\s*\{[^}]*color:\s*var\(--text-color\)/);
    expect(stdout).toMatch(/\.button:hover\s*\{[^}]*padding:\s*8px/);
});

test("fails the build for an undefined variable in compiled Sass", async () => {
    await expect(runBuild("invalid")).rejects.toMatchObject({
        stderr: /Odefinierad CSS-variabel: "--missing-color"/,
    });
});
