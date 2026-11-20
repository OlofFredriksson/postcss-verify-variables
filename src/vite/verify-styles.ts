import { type Processor, parse, root as createRoot } from "postcss";

/**
 * Verify stylesheets together as one root. Each stylesheet is parsed with its
 * own file name so that errors point at the right file, line and column.
 */
export async function verifyStyles(
    processor: Processor,
    sources: Iterable<[file: string, code: string]>,
): Promise<void> {
    const root = createRoot();
    for (const [file, code] of sources) {
        root.append(parse(code, { from: file }).nodes);
    }
    await processor.process(root, { from: undefined });
}
