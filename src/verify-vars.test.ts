import postcss, { type Result } from "postcss";
import { describe, expect, it } from "vitest";
import verifyVars, { type VerifyOptions } from "./verify-vars.ts";

const processCss = async (
    css: string,
    options?: VerifyOptions,
): Promise<Result> =>
    postcss([verifyVars(options)]).process(css, { from: undefined });

describe("verifyVars", () => {
    it("allows variables defined anywhere in the stylesheet", async () => {
        const result = await processCss(
            ".component { color: var(--text-color); } :root { --text-color: black; }",
        );

        expect(result.css).toBe(
            ".component { color: var(--text-color); } :root { --text-color: black; }",
        );
    });

    it("allows variables defined in the html selector", async () => {
        const css =
            "html { --text-color: black; } .component { color: var(--text-color); }";

        const result = await processCss(css);

        expect(result.css).toBe(css);
    });

    it("rejects undefined references within the html selector", async () => {
        await expect(
            processCss("html { --text-color: var(--missing); }"),
        ).rejects.toThrow("--missing");
    });

    it("rejects an undefined variable and reports its declaration", async () => {
        await expect(
            processCss(".component { color: var(--missing); }"),
        ).rejects.toMatchObject({
            reason: [
                'CSS variable "--missing" referenced in "color" could not be verified.',
                'It is not declared in the processed CSS or "global" and is not listed in "ignore".',
                "Declare the variable in the processed CSS.",
                'If it is defined elsewhere, provide its CSS via "global" or add its name to "ignore".',
            ].join("\n"),
        });
    });

    it("displays the error banner before the verification message", async () => {
        await expect(
            processCss(".component { color: var(--missing); }", {
                errorBanner: "Custom banner\nMore context",
            }),
        ).rejects.toMatchObject({
            reason: [
                "Custom banner\nMore context",
                'CSS variable "--missing" referenced in "color" could not be verified.',
                'It is not declared in the processed CSS or "global" and is not listed in "ignore".',
                "Declare the variable in the processed CSS.",
                'If it is defined elsewhere, provide its CSS via "global" or add its name to "ignore".',
            ].join("\n"),
        });
    });

    it("does not add a blank line for an empty error banner", async () => {
        await expect(
            processCss(".component { color: var(--missing); }", {
                errorBanner: "",
            }),
        ).rejects.toMatchObject({
            reason: expect.stringMatching(/^CSS variable "--missing"/),
        });
    });

    it("allows undefined variables listed in ignore", async () => {
        const result = await processCss(
            ".component { color: var(--external); }",
            {
                ignore: ["--external"],
            },
        );

        expect(result.css).toBe(".component { color: var(--external); }");
    });

    it("allows variables declared in the global CSS", async () => {
        const result = await processCss(
            ".component { color: var(--global-color); }",
            {
                global: ":root { --global-color: rebeccapurple; }",
            },
        );

        expect(result.css).toBe(".component { color: var(--global-color); }");
    });

    it("does not check undefined variable references in global CSS", async () => {
        const result = await processCss(".component { color: red; }", {
            global: ":root { color: var(--missing); }",
        });

        expect(result.css).toBe(".component { color: red; }");
    });

    it.each(["/* --missing: red; */", ':root { content: "--missing: red;"; }'])(
        "does not treat non-declarations in global CSS as variables: %s",
        async (global) => {
            await expect(
                processCss(".component { color: var(--missing); }", { global }),
            ).rejects.toThrow("--missing");
        },
    );

    it("rejects malformed global CSS", async () => {
        await expect(
            processCss(".component { color: red; }", {
                global: ":root { --color: red;",
            }),
        ).rejects.toThrow("Unclosed block");
    });

    it("treats the var() function name case-insensitively", async () => {
        await expect(
            processCss(".component { color: VAR(--missing); }"),
        ).rejects.toThrow("--missing");

        const result = await processCss(
            ":root { --text-color: black; } .component { color: Var(--text-color); }",
        );

        expect(result.css).toContain("Var(--text-color)");
    });

    it("checks variables nested in fallbacks", async () => {
        await expect(
            processCss(
                ":root { --text-color: black; } .component { color: var(--text-color, var(--fallback)); }",
            ),
        ).rejects.toThrow("--fallback");
    });
});
