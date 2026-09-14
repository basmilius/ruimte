import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { APP_REDIRECT_LOOPBACK_PATH } from '@ruimte/pulsar';

// Long enough to type a password and a second factor at the provider; a login left open past it is given up.
export const LOGIN_WAIT_MS = 10 * 60_000;

/* What the address book sent the browser back with. The client checks the state; this only carries it. */
export interface LoginCallback {
    code: string | null;
    state: string | null;
    error: string | null;
}

export interface LoopbackLogin {
    redirectUri: string;
    // Settles with the first callback, rejects when the wait runs out or the login is cancelled.
    callback: Promise<LoginCallback>;
    cancel(): void;
}

const page = (response: ServerResponse, status: number, text: string): void => {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`${text}\n`);
};

/*
 * A listener on a random loopback port for the one redirect a login ends in. A loopback listener
 * rather than the `ruimte://` scheme, because Electron only claims a scheme for a packaged app and an
 * unpackaged "Ruimte Dev" beside an installed Ruimte would hand the code to the wrong one. Bound to
 * 127.0.0.1 only, it takes the first request on the callback path and closes, so the code is read
 * once and the port is gone before anything else could ask.
 */
export const listenForLogin = (options: { timeoutMs?: number } = {}): Promise<LoopbackLogin> =>
    new Promise((resolveListening, rejectListening) => {
        let settle: { resolve(value: LoginCallback): void; reject(reason: Error): void } | null = null;
        const callback = new Promise<LoginCallback>((resolve, reject) => {
            settle = { resolve, reject };
        });
        // Nobody may be waiting yet when a cancel or a timeout rejects it.
        callback.catch(() => undefined);

        const finish = (outcome: { value: LoginCallback } | { error: Error }): void => {
            const pending = settle;
            settle = null;
            clearTimeout(timer);
            server.close();
            server.closeAllConnections();
            if (!pending) {
                return;
            }
            if ('value' in outcome) {
                pending.resolve(outcome.value);
            } else {
                pending.reject(outcome.error);
            }
        };

        const server = createServer((request: IncomingMessage, response: ServerResponse) => {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            if (request.method !== 'GET' || url.pathname !== APP_REDIRECT_LOOPBACK_PATH || settle === null) {
                page(response, 404, 'Not found');
                return;
            }
            const value: LoginCallback = {
                code: url.searchParams.get('code'),
                state: url.searchParams.get('state'),
                error: url.searchParams.get('error')
            };
            page(
                response,
                200,
                value.error === null ? 'Signed in. You can close this tab and go back to Ruimte.' : 'Signing in did not work. Go back to Ruimte to try again.'
            );
            finish({ value });
        });

        const timer = setTimeout(() => finish({ error: new Error('The sign-in took too long') }), options.timeoutMs ?? LOGIN_WAIT_MS);

        server.on('error', (e) => {
            clearTimeout(timer);
            rejectListening(e);
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolveListening({
                redirectUri: `http://127.0.0.1:${port}${APP_REDIRECT_LOOPBACK_PATH}`,
                callback,
                cancel: () => finish({ error: new Error('The sign-in was cancelled') })
            });
        });
    });
