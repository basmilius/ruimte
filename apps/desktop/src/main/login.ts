import { join } from 'node:path';
import type { AppIpc } from '@adecore/shell';
import { AddressBookClient, ADDRESS_BOOK_URL, SessionKeyUnavailableError, SessionLoginCodeSchema, SessionVault } from '@ruimte/pulsar';
import { heedBodyless } from '../net-response';
import { listenForLogin, type LoopbackLogin } from '../pulsar-login';
import { fileSessionKey, fileSessionStore } from '../pulsar-store';
import { electron } from './electron';
import { reportShellProblem } from './telemetry';

const { app, net, safeStorage } = electron;

/*
 * The page runs the login (PKCE, state, start URL); this side listens on loopback for the redirect and
 * holds the refresh token and the session key, encrypted with the OS keychain. The page only gets access tokens.
 */
export function installLogin(ipc: AppIpc): { signedIn(): Promise<boolean> } {
    const addressBookUrl = process.env.RUIMTE_PULSAR_URL ?? ADDRESS_BOOK_URL;
    const store = fileSessionStore(join(app.getPath('userData'), 'pulsar-session.bin'), safeStorage);
    let pulsarVault: SessionVault | null = null;
    let pendingLogin: LoopbackLogin | null = null;

    const pulsarSessions = (): SessionVault => {
        pulsarVault ??= new SessionVault({
            client: new AddressBookClient({ baseUrl: addressBookUrl, fetch: (input, init) => net.fetch(input, init).then(heedBodyless) }),
            store,
            signer: fileSessionKey(join(app.getPath('userData'), 'pulsar-key.bin'), safeStorage),
            onForget: (reason) => {
                console.warn(`The account session was cleared (${reason})`);
                // A session that ran out unused is the lifetime doing its work, not a problem.
                if (reason !== 'expired') {
                    reportShellProblem({ kind: 'session-cleared', reason });
                }
            }
        });
        return pulsarVault;
    };

    ipc.handle('pulsar:address-book', () => addressBookUrl);

    ipc.handle('pulsar:login-listen', async () => {
        // One login at a time: a second click starts over rather than leaving a port open for the first.
        pendingLogin?.cancel();
        pendingLogin = await listenForLogin();
        return { redirectUri: pendingLogin.redirectUri };
    });

    ipc.handle('pulsar:login-callback', async (event) => {
        const login = pendingLogin;
        if (!login) {
            throw new Error('No sign-in is waiting');
        }
        try {
            const callback = await login.callback;
            // The login ended in the system browser, which keeps the focus while the answer lands in the window that asked.
            const window = ipc.senderWindow(event);
            if (window) {
                if (window.isMinimized()) {
                    window.restore();
                }
                window.show();
                if (process.platform === 'darwin') {
                    app.focus({ steal: true });
                }
                window.focus();
            }
            return callback;
        } finally {
            if (pendingLogin === login) {
                pendingLogin = null;
            }
        }
    });

    ipc.handle('pulsar:login-cancel', () => {
        pendingLogin?.cancel();
        pendingLogin = null;
    });

    ipc.handle('pulsar:exchange', (_event, payload: unknown) => pulsarSessions().exchange(SessionLoginCodeSchema.parse(payload)));
    ipc.handle('pulsar:refresh', () =>
        pulsarSessions()
            .refresh()
            .catch((e: unknown) => {
                if (e instanceof SessionKeyUnavailableError) {
                    console.warn(e.message);
                    reportShellProblem({ kind: 'session-key-unreadable' });
                }
                throw e;
            })
    );
    ipc.handle('pulsar:restore', () => pulsarSessions().restore());
    ipc.handle('pulsar:sign-out', () => pulsarSessions().signOut());

    // A session on disk, without asking the address book whether it still holds.
    return { signedIn: async () => (await store.read()) !== null };
}
