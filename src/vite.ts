import { type ErrorPayload, type Plugin, normalizePath } from "vite";
import postcss, { CssSyntaxError } from "postcss";
import verifyVars, {
    type VerifyOptions,
    VERIFY_VARS_PLUGIN_NAME,
} from "./verify-vars.ts";

const CSS_REQUEST =
    /\.(css|pcss|postcss|sass|scss|less|styl|stylus|sss)(?:$|\?)/i;
const VERIFICATION_DELAY = 75;

function isCssRequest(id: string): boolean {
    return (
        CSS_REQUEST.test(id) &&
        !/[?&](?:worker|sharedworker|raw|url)\b/.test(id)
    );
}

function verifyOutput(options: VerifyOptions): Plugin {
    return {
        name: "verify-variables:output",
        apply: "build",
        enforce: "post",
        configResolved(config) {
            const output = config.build.rolldownOptions.output;
            if (Array.isArray(output) && output.length > 1) {
                throw new Error(
                    "verifyVarsVite does not support builds with multiple output configurations.",
                );
            }
        },
        generateBundle: {
            order: "post",
            async handler(_outputOptions, bundle) {
                const sources: Array<[string, string]> = [];
                for (const asset of Object.values(bundle)) {
                    if (
                        asset.type === "asset" &&
                        asset.fileName.endsWith(".css")
                    ) {
                        sources.push([
                            asset.fileName,
                            typeof asset.source === "string"
                                ? asset.source
                                : new TextDecoder().decode(asset.source),
                        ]);
                    }
                }

                try {
                    await postcss([verifyVars(options)]).process(
                        sources.map(([, code]) => code).join("\n\n"),
                        { from: undefined },
                    );
                } catch (error) {
                    if (
                        error instanceof CssSyntaxError &&
                        error.plugin === VERIFY_VARS_PLUGIN_NAME
                    ) {
                        const { message } = formatError(error, sources);
                        this.error({ message, stack: "" });
                    }
                    throw error;
                }
            },
        },
    };
}

function sourceLocation(
    error: CssSyntaxError,
    styles: Array<[string, string]>,
): ErrorPayload["err"]["loc"] {
    if (!error.input) {
        return undefined;
    }

    let line = error.input.line;
    for (const [file, css] of styles) {
        if (line < 1) {
            return undefined;
        }
        const lines = (css.match(/\n/g)?.length ?? 0) + 1;
        if (line <= lines) {
            return { file, line, column: error.input.column };
        }
        line -= lines + 1;
    }
    return undefined;
}

function formatError(
    error: Error,
    sources: Array<[string, string]>,
): {
    message: string;
    location: ErrorPayload["err"]["loc"];
    preprocessed: boolean;
} {
    const location =
        error instanceof CssSyntaxError
            ? sourceLocation(error, sources)
            : undefined;
    const extension = location?.file?.match(CSS_REQUEST)?.[1].toLowerCase();
    const preprocessed =
        Boolean(extension && !["css", "pcss", "postcss"].includes(extension)) ||
        Boolean(location?.file && /[?&]vue(?:&|$)/.test(location.file));
    if (!location) {
        return { message: error.message, location, preprocessed };
    }

    const reason =
        error instanceof CssSyntaxError ? error.reason : error.message;
    const position = `${location.line}:${location.column}`;
    const source = preprocessed
        ? `${location.file} (processed CSS:${position})`
        : `${location.file}:${position}`;
    return { message: `${source}: ${reason}`, location, preprocessed };
}

function verifyDevelopment(options: VerifyOptions): Plugin {
    const styles = new Map<string, string>();
    let scheduleVerification: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    return {
        name: "verify-variables:development",
        apply: "serve",
        configureServer(server) {
            disposed = false;
            let activeError: ErrorPayload | undefined;

            let processor: ReturnType<typeof postcss>;
            try {
                processor = postcss([verifyVars(options)]);
            } catch (error) {
                if (!(error instanceof Error)) {
                    server.config.logger.error(String(error));
                    return;
                }
                server.config.logger.warn(error.message);
                return;
            }

            const verifyLoadedStyles = async (): Promise<void> => {
                timer = undefined;
                if (styles.size === 0) {
                    activeError = undefined;
                    return;
                }

                const sources = Array.from(styles);
                const css = sources.map(([, code]) => code).join("\n\n");

                try {
                    await processor.process(css, { from: undefined });
                    if (disposed) {
                        return;
                    }
                    activeError = undefined;
                } catch (error) {
                    if (disposed) {
                        return;
                    }
                    if (!(error instanceof Error)) {
                        server.config.logger.error(String(error));
                        return;
                    }

                    const { message, location, preprocessed } = formatError(
                        error,
                        sources,
                    );
                    if (message === activeError?.err.message) {
                        return;
                    }

                    server.config.logger.warn(message);
                    activeError = {
                        type: "error",
                        err: {
                            message,
                            stack: "",
                            plugin: "verify-variables:development",
                            id: location?.file,
                            loc: preprocessed ? undefined : location,
                        },
                    };
                    if (server.ws.clients.size > 0) {
                        server.ws.send(activeError);
                    }
                }
            };

            server.ws.on("vite:client:connect", (_data, client) => {
                if (activeError) {
                    client.send(activeError);
                }
            });

            scheduleVerification = () => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                timer = setTimeout(() => {
                    void verifyLoadedStyles();
                }, VERIFICATION_DELAY);
            };

            server.watcher.on("unlink", (file) => {
                const normalized = normalizePath(file);
                let removed = false;
                for (const id of styles.keys()) {
                    if (id.split("?", 1)[0] === normalized) {
                        removed = styles.delete(id) || removed;
                    }
                }
                if (removed) {
                    scheduleVerification?.();
                }
            });
            server.watcher.on("unlinkDir", (directory) => {
                const normalized = normalizePath(directory);
                let removed = false;
                for (const id of styles.keys()) {
                    if (id.startsWith(`${normalized}/`)) {
                        removed = styles.delete(id) || removed;
                    }
                }
                if (removed) {
                    scheduleVerification?.();
                }
            });
        },
        buildEnd() {
            disposed = true;
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            scheduleVerification = undefined;
        },
        transform(code, id) {
            if (!isCssRequest(id)) {
                return;
            }

            const [file] = id.split("?", 1);
            const cssId = /[?&]vue(?:&|$)/.test(id)
                ? `${normalizePath(file)}${id.slice(file.length)}`
                : normalizePath(file);
            if (styles.get(cssId) === code) {
                return;
            }
            styles.set(cssId, code);
            scheduleVerification?.();
        },
    };
}

/**
 * Verify all generated Vite CSS assets together.
 */
export function verifyVarsVite(options: VerifyOptions = {}): Plugin[] {
    return [verifyOutput(options), verifyDevelopment(options)];
}
