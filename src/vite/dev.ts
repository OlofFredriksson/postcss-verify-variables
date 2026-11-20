import type { ErrorPayload, Plugin, ViteDevServer } from "vite";
import { normalizePath } from "vite";
import postcss, { type Processor, CssSyntaxError } from "postcss";
import verifyVars, { type VerifyOptions } from "../verify-vars.ts";
import { verifyStyles } from "./verify-styles.ts";

const STYLE_FILE = /\.(?:css|pcss|postcss|sass|scss|less|styl|stylus)$/i;
const PREPROCESSED_FILE = /\.(?:sass|scss|less|styl|stylus)$/i;
const NON_CSS_QUERY = /[?&](?:worker|sharedworker|raw|url)\b/;
const VERIFICATION_DELAY_MS = 75;

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function createErrorPayload(error: Error): ErrorPayload {
    const syntaxError = error instanceof CssSyntaxError ? error : undefined;
    const location: ErrorPayload["err"]["loc"] =
        syntaxError?.file !== undefined && syntaxError.line !== undefined
            ? {
                  file: syntaxError.file,
                  line: syntaxError.line,
                  column: syntaxError.column ?? 1,
              }
            : undefined;
    const preprocessed =
        location?.file !== undefined && PREPROCESSED_FILE.test(location.file);

    let message = error.message;
    if (syntaxError && location) {
        const position = `${location.line}:${location.column}`;
        const source = preprocessed
            ? `${location.file} (processed CSS:${position})`
            : `${location.file}:${position}`;
        message = `${source}: ${syntaxError.reason}`;
    }

    return {
        type: "error",
        err: {
            message,
            stack: "",
            plugin: "verify-variables:development",
            id: location?.file,
            loc: preprocessed ? undefined : location,
        },
    };
}

interface StyleVerifier {
    update(id: string, code: string): void;
    remove(matches: (id: string) => boolean): void;
    dispose(): void;
}

function createStyleVerifier(
    server: ViteDevServer,
    options: VerifyOptions,
): StyleVerifier | undefined {
    let processor: Processor;
    try {
        processor = postcss([verifyVars(options)]);
    } catch (error) {
        server.config.logger.warn(toError(error).message);
        return undefined;
    }

    const styles = new Map<string, string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeError: ErrorPayload | undefined;

    // The error overlay is only cleared by Vite on an HMR update or reload, so
    // tell connected clients to reload once a reported error has been fixed.
    function clearActiveError(): void {
        if (!activeError) {
            return;
        }
        activeError = undefined;
        if (server.ws.clients.size > 0) {
            server.ws.send({ type: "full-reload" });
        }
    }

    async function verifyLoadedStyles(): Promise<void> {
        timer = undefined;
        if (styles.size === 0) {
            clearActiveError();
            return;
        }

        try {
            await verifyStyles(processor, styles);
            clearActiveError();
        } catch (error) {
            const payload = createErrorPayload(toError(error));
            if (payload.err.message === activeError?.err.message) {
                return;
            }

            server.config.logger.warn(payload.err.message);
            activeError = payload;
            if (server.ws.clients.size > 0) {
                server.ws.send(payload);
            }
        }
    }

    function schedule(): void {
        clearTimeout(timer);
        timer = setTimeout(() => {
            void verifyLoadedStyles();
        }, VERIFICATION_DELAY_MS);
    }

    server.ws.on("vite:client:connect", (_data, client) => {
        if (activeError) {
            client.send(activeError);
        }
    });

    return {
        update(id, code) {
            if (styles.get(id) === code) {
                return;
            }
            styles.set(id, code);
            schedule();
        },
        remove(matches) {
            const removed = styles.keys().filter(matches).toArray();
            for (const id of removed) {
                styles.delete(id);
            }
            if (removed.length > 0) {
                schedule();
            }
        },
        dispose() {
            clearTimeout(timer);
        },
    };
}

export function verifyDevelopment(options: VerifyOptions): Plugin {
    let verifier: StyleVerifier | undefined;

    return {
        name: "verify-variables:development",
        apply: "serve",
        configureServer(server) {
            const current = createStyleVerifier(server, options);
            if (!current) {
                return;
            }
            verifier = current;

            server.watcher.on("unlink", (file) => {
                const normalized = normalizePath(file);
                current.remove((id) => id === normalized);
            });
            server.watcher.on("unlinkDir", (directory) => {
                const normalized = normalizePath(directory);
                current.remove((id) => id.startsWith(`${normalized}/`));
            });
            server.httpServer?.once("close", () => {
                current.dispose();
                verifier = undefined;
            });
        },
        transform(code, id) {
            const cssId = normalizePath(id.split("?", 1)[0]);
            if (!STYLE_FILE.test(cssId) || NON_CSS_QUERY.test(id)) {
                return;
            }
            verifier?.update(cssId, code);
        },
    };
}
