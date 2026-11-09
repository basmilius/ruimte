import type { ServerConfig } from '../config.ts';
import { CONTEXT_PATH } from '../context/context-store.ts';
import { HOOKS_PATH } from '../sessions/hook-receiver.ts';

/* Where this daemon runs from and how it is reached, settled by `daemon.ts` before anything is wired. */
export interface DaemonRuntime {
    config: ServerConfig;
    compiled: boolean;
    /* The server's `src` folder; a wiring module's own `import.meta.dir` is not it. */
    sourceDir: string;
    /* The `/context` route an agent's session is told about; the MCP endpoint sits beside it (`mcpUrlOf`). */
    contextUrl: string;
    hookUrl: string;
}

/* Hooks and context always go over loopback, whatever interface the socket listens on. */
export function loopbackUrls(port: number): Pick<DaemonRuntime, 'contextUrl' | 'hookUrl'> {
    return { contextUrl: `http://127.0.0.1:${port}${CONTEXT_PATH}`, hookUrl: `http://127.0.0.1:${port}${HOOKS_PATH}` };
}
