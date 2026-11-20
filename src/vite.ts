import type { Plugin } from "vite";
import type { VerifyOptions } from "./verify-vars.ts";
import { verifyDevelopment } from "./vite/dev.ts";
import { verifyOutput } from "./vite/output.ts";

/**
 * Verify all generated Vite CSS assets together.
 */
export function verifyVarsVite(options: VerifyOptions = {}): Plugin[] {
    return [verifyOutput(options), verifyDevelopment(options)];
}
