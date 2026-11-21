import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

function runBuild(
    name: string,
    globalFile?: string,
): Promise<{ stdout: string; stderr: string }> {
    const run = promisify(execFile);
    const build = fileURLToPath(new URL("build.mjs", import.meta.url));
    const fixture = fileURLToPath(
        new URL(`sass/${name}.scss`, import.meta.url),
    );
    const args = [build, fixture];
    if (globalFile) {
        args.push(
            fileURLToPath(new URL(`sass/${globalFile}`, import.meta.url)),
        );
    }
    return run(process.execPath, args);
}

test("compiles Sass modules and verifies the resulting CSS", async () => {
    const { stdout } = await runBuild("valid");

    expect(stdout).toMatchInlineSnapshot(`
      ":root {
        --text-color: #123456;
      }

      .button {
        color: var(--text-color);
      }
      .button:hover {
        padding: 8px;
      }
      "
    `);
});

test("fails the build for an undefined variable in compiled Sass", async () => {
    await expect(runBuild("invalid")).rejects.toMatchObject({
        stderr: expect.stringContaining(
            'Odefinierad CSS-variabel: "--missing-color" används i "color", men saknas i den byggda CSS-filen.',
        ),
    });
});

test("allows variables declared in already compiled global CSS", async () => {
    const { stdout } = await runBuild("global", "global.css");

    expect(stdout).toMatchInlineSnapshot(`
      ".button {
        color: var(--global-color);
      }
      "
    `);
});
