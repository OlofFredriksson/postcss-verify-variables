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

test("finds variables declared in deeply nested Sass modules", async () => {
    const { stdout } = await runBuild("deep");

    expect(stdout).toMatchInlineSnapshot(`
      ".component {
        color: var(--deep-color);
      }

      :root {
        --deep-color: #123456;
      }
      "
    `);
});

test("fails the build for an undefined variable in compiled Sass", async () => {
    await expect(runBuild("invalid")).rejects.toMatchObject({
        stderr: expect.stringContaining(
            [
                'CSS variable "--missing-color" referenced in "color" could not be verified.',
                'It is not declared in the processed CSS or "global" and is not listed in "ignore".',
                "Declare the variable in the processed CSS.",
                'If it is defined elsewhere, provide its CSS via "global" or add its name to "ignore".',
            ].join("\n"),
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
