import { create } from 'zustand';
import { APP_REDIRECT_LOOPBACK_PATH, AddressBookClient, AddressBookRequestError, type Account } from '@ruimte/pulsar';
import { currentClientLabel } from '@/endpoint/client-label';
import { desktopPulsar, type PulsarPlatform } from './desktop';
import { signIn } from './login';
import { AccessTokens } from './session';
import { beginWebLogin, completeWebLogin, webPulsar } from './web';

/* `unavailable` is a page with no platform to sign in on: a browser on an origin the address book does not send a login back to. */
export type AccountStatus = 'unavailable' | 'loading' | 'signed-out' | 'signing-in' | 'signed-in';

interface AccountState {
    status: AccountStatus;
    account: Account | null;
    error: string | null;
    /*
     * A session that ended without anything going wrong: it ran out, or this device lost the key it was
     * bound to (a browser that cleared the site's storage). Said plainly, next to the way back in.
     */
    notice: string | null;
}

/* Who this client is signed in as on the address book. */
export const usePulsarAccount = create<AccountState>(() => ({ status: 'loading', account: null, error: null, notice: null }));

const SESSION_ENDED = 'Your session on this device ended. Sign in again to open your machines.';

let platform: PulsarPlatform | null = null;
let tokens: AccessTokens | null = null;
let book: Promise<AddressBookClient> | null = null;

/* An error from across the bridge carries Electron's own prefix, which says nothing to a person. */
export const messageOf = (e: unknown): string =>
    (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, '');

const signedOut = (error: string | null, notice: string | null = null): void => {
    tokens?.set(null);
    usePulsarAccount.setState({ status: 'signed-out', account: null, error, notice });
};

/* Safari clears a site's storage after a week without a visit unless the site may keep it, and the session and its key live there. */
const keepStorage = (): void => {
    void navigator.storage?.persist?.().catch(() => false);
};

/*
 * The page came back from the address book. The code leaves the address bar before anything else, so
 * a reload or a screenshot carries none, and a return that fails leaves whoever was signed in before.
 */
const finishWebSignIn = async (given: PulsarPlatform, web: NonNullable<PulsarPlatform['web']>): Promise<void> => {
    const query = new URLSearchParams(location.search);
    history.replaceState(null, '', '/');
    usePulsarAccount.setState({ status: 'signing-in', error: null, notice: null });
    try {
        const { code, verifier, redirectUri } = completeWebLogin(web.storage, query);
        const view = await given.keeper.exchange({ code, codeVerifier: verifier, redirectUri, label: currentClientLabel().slice(0, 80) });
        tokens?.set(view);
        usePulsarAccount.setState({ status: 'signed-in', account: view.account, error: null, notice: null });
        keepStorage();
    } catch (e) {
        const restored = await given.keeper.restore().catch(() => null);
        usePulsarAccount.setState({ status: restored ? 'signed-in' : 'signed-out', account: restored?.account ?? null, error: messageOf(e), notice: null });
    }
};

/* Reads who is signed in from the platform's keeper, without asking the address book. */
export const startPulsarAccount = async (given: PulsarPlatform | null = desktopPulsar() ?? webPulsar()): Promise<void> => {
    platform = given;
    book = null;
    if (!given) {
        tokens = null;
        usePulsarAccount.setState({ status: 'unavailable', account: null, error: null, notice: null });
        return;
    }
    tokens = new AccessTokens(given.keeper, { onSignedOut: () => signedOut(null, SESSION_ENDED) });
    if (given.web && location.pathname === APP_REDIRECT_LOOPBACK_PATH) {
        await finishWebSignIn(given, given.web);
        return;
    }
    try {
        const restored = await given.keeper.restore();
        usePulsarAccount.setState(
            restored
                ? { status: 'signed-in', account: restored.account, error: null, notice: null }
                : { status: 'signed-out', account: null, error: null, notice: null }
        );
    } catch (e) {
        signedOut(messageOf(e));
    }
};

export const signInToPulsar = async (): Promise<void> => {
    if (!platform || !tokens) {
        return;
    }
    const { web, redirect } = platform;
    usePulsarAccount.setState({ status: 'signing-in', error: null, notice: null });
    if (web) {
        try {
            location.assign(await beginWebLogin(web.storage, { addressBookUrl: await platform.addressBook(), redirectUri: web.redirectUri }));
        } catch (e) {
            const { account } = usePulsarAccount.getState();
            usePulsarAccount.setState({ status: account ? 'signed-in' : 'signed-out', error: messageOf(e) });
        }
        return;
    }
    if (!redirect) {
        return;
    }
    try {
        const view = await signIn({
            redirect,
            keeper: platform.keeper,
            addressBookUrl: await platform.addressBook(),
            label: currentClientLabel()
        });
        tokens.set(view);
        usePulsarAccount.setState({ status: 'signed-in', account: view.account, error: null });
    } catch (e) {
        const { account } = usePulsarAccount.getState();
        usePulsarAccount.setState({ status: account ? 'signed-in' : 'signed-out', error: messageOf(e) });
    }
};

export const cancelPulsarSignIn = async (): Promise<void> => {
    await platform?.redirect?.cancel().catch(() => undefined);
};

export const signOutOfPulsar = async (): Promise<void> => {
    if (!platform) {
        return;
    }
    await platform.keeper.signOut().catch(() => undefined);
    signedOut(null);
};

const addressBookClient = (): Promise<AddressBookClient> => {
    if (!platform) {
        return Promise.reject(new Error('Signing in works in the desktop app and at station.ruimte.app'));
    }
    book ??= platform.addressBook().then((baseUrl) => new AddressBookClient({ baseUrl }));
    return book;
};

/*
 * One call against the address book with a fresh access token. An `unauthorized` answer refreshes
 * once and tries again, since a token can run out between the check and the request.
 */
export const withAccessToken = async <T>(call: (client: AddressBookClient, token: string) => Promise<T>): Promise<T> => {
    const client = await addressBookClient();
    const token = await tokens?.token();
    if (!token) {
        throw new Error('Sign in to your account first');
    }
    try {
        return await call(client, token);
    } catch (e) {
        if (!(e instanceof AddressBookRequestError) || e.code !== 'unauthorized') {
            throw e;
        }
        const fresh = await tokens?.refreshNow();
        if (!fresh) {
            throw new Error('Your session ended. Sign in again.');
        }
        return call(client, fresh);
    }
};
