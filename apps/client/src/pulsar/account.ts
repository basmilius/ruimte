import { create } from 'zustand';
import { AddressBookClient, AddressBookRequestError, type Account } from '@ruimte/pulsar';
import { currentClientLabel } from '@/endpoint/client-label';
import { desktopPulsar, type PulsarPlatform } from './desktop';
import { signIn } from './login';
import { AccessTokens } from './session';

/* `unavailable` is a page with no platform to sign in on: a plain browser. */
export type AccountStatus = 'unavailable' | 'loading' | 'signed-out' | 'signing-in' | 'signed-in';

interface AccountState {
    status: AccountStatus;
    account: Account | null;
    error: string | null;
}

/* Who this client is signed in as on the address book. */
export const usePulsarAccount = create<AccountState>(() => ({ status: 'loading', account: null, error: null }));

let platform: PulsarPlatform | null = null;
let tokens: AccessTokens | null = null;
let book: Promise<AddressBookClient> | null = null;

/* An error from across the bridge carries Electron's own prefix, which says nothing to a person. */
export const messageOf = (e: unknown): string =>
    (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, '');

const signedOut = (error: string | null): void => {
    tokens?.set(null);
    usePulsarAccount.setState({ status: 'signed-out', account: null, error });
};

/* Reads who is signed in from the platform's keeper, without asking the address book. */
export const startPulsarAccount = async (given: PulsarPlatform | null = desktopPulsar()): Promise<void> => {
    platform = given;
    book = null;
    if (!given) {
        tokens = null;
        usePulsarAccount.setState({ status: 'unavailable', account: null, error: null });
        return;
    }
    tokens = new AccessTokens(given.keeper, { onSignedOut: () => signedOut('Your session ended. Sign in again.') });
    try {
        const restored = await given.keeper.restore();
        usePulsarAccount.setState(
            restored ? { status: 'signed-in', account: restored.account, error: null } : { status: 'signed-out', account: null, error: null }
        );
    } catch (e) {
        signedOut(messageOf(e));
    }
};

export const signInToPulsar = async (): Promise<void> => {
    if (!platform || !tokens) {
        return;
    }
    usePulsarAccount.setState({ status: 'signing-in', error: null });
    try {
        const view = await signIn({
            redirect: platform.redirect,
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
    await platform?.redirect.cancel().catch(() => undefined);
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
        return Promise.reject(new Error('Signing in works in the desktop app'));
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
