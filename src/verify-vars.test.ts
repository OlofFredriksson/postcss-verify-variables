import postcss, { type Result } from "postcss";
import { describe, expect, it } from "vitest";
import verifyVars from "./verify-vars.ts";

const processCss = async (
    css: string,
    options?: { ignore?: string[] },
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

    it("rejects an undefined variable and reports its declaration", async () => {
        await expect(
            processCss(".component { color: var(--missing); }"),
        ).rejects.toThrow(
            'Odefinierad CSS-variabel: "--missing" används i "color", men saknas i den byggda CSS-filen.',
        );
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
