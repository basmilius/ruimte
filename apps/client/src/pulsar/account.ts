import i18next from 'i18next';
import { create } from 'zustand';
import {
    APP_REDIRECT_LOOPBACK_PATH,
    AddressBookClient,
    AddressBookRequestError,
    type Account,
    type AccountResult,
    type Identity,
    type IdentityLinkCompletePayload,
    type ProviderId
} from '@ruimte/pulsar';
import { currentClientLabel } from '@/endpoint/client-label';
import { useUi } from '@/state/ui';
import { offeredProviders } from './account-name';
import { confirmAccount, dismissAccountConfirmation, linkedConfirmation, signedInConfirmation } from './confirmation';
import { desktopPulsar, type PulsarPlatform } from './desktop';
import { linkIdentity, signIn } from './login';
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
    /* What the address book can sign in with. GitHub until it says otherwise, so a slow answer never hides the only choice there was. */
    providers: ProviderId[];
    /* The ways to sign in to this account, once asked for; null before that and when signed out. */
    identities: Identity[] | null;
    /* The provider being added to the account while its login is open. */
    linking: ProviderId | null;
}

/* Who this client is signed in as on the address book. */
export const usePulsarAccount = create<AccountState>(() => ({
    status: 'loading',
    account: null,
    error: null,
    notice: null,
    providers: ['github'],
    identities: null,
    linking: null
}));

/* Read when a session ends rather than at module load, where the words are not in yet. */
const sessionEnded = (): string => i18next.t('machines:account.sessionEndedOnDevice');

let platform: PulsarPlatform | null = null;
let tokens: AccessTokens | null = null;
let book: Promise<AddressBookClient> | null = null;

/* An error from across the bridge carries Electron's own prefix, which says nothing to a person. */
export const messageOf = (e: unknown): string =>
    (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, '');

/* The Remote pane, where the account section says how a sign-in it started went, even when the dialog was closed meanwhile. */
const openAccountSection = (): void => {
    useUi.getState().setSettings({ open: true, section: 'machines' });
};

const signedOut = (error: string | null, notice: string | null = null): void => {
    tokens?.set(null);
    usePulsarAccount.setState({ status: 'signed-out', account: null, error, notice, identities: null, linking: null });
};

const applyAccountResult = (result: AccountResult): void => {
    usePulsarAccount.setState({ account: result.account, identities: result.identities, linking: null, error: null });
};

const completeLink = (payload: IdentityLinkCompletePayload): Promise<AccountResult> =>
    withAccessToken((client, token) => client.completeIdentityLink(token, payload));

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
    // Known once the pending login is read, which spends it, so a reload of this page confirms nothing twice.
    let confirm = false;
    try {
        const { code, verifier, redirectUri, link, provider, confirm: fromSection } = completeWebLogin(web.storage, query);
        confirm = fromSection;
        if (link) {
            await finishWebLink(given, provider, { code, codeVerifier: verifier, redirectUri });
            return;
        }
        const view = await given.keeper.exchange({ code, codeVerifier: verifier, redirectUri, label: currentClientLabel().slice(0, 80) });
        tokens?.set(view);
        usePulsarAccount.setState({ status: 'signed-in', account: view.account, error: null, notice: null });
        keepStorage();
        if (confirm) {
            confirmAccount(signedInConfirmation(provider, view.account));
            openAccountSection();
        }
    } catch (e) {
        const restored = await given.keeper.restore().catch(() => null);
        usePulsarAccount.setState({ status: restored ? 'signed-in' : 'signed-out', account: restored?.account ?? null, error: messageOf(e), notice: null });
        if (confirm) {
            openAccountSection();
        }
    }
};

/* The page came back from adding a provider: the session it left with trades the code, and stays signed in whatever the answer. */
const finishWebLink = async (given: PulsarPlatform, provider: ProviderId, payload: IdentityLinkCompletePayload): Promise<void> => {
    const restored = await given.keeper.restore().catch(() => null);
    if (!restored) {
        signedOut(null, sessionEnded());
        return;
    }
    usePulsarAccount.setState({ status: 'signed-in', account: restored.account, error: null, notice: null });
    try {
        applyAccountResult(await completeLink(payload));
        confirmAccount(linkedConfirmation(provider));
    } catch (e) {
        usePulsarAccount.setState({ error: messageOf(e), linking: null });
    }
    // Adding a provider only starts in the account section, so the way back always leads there.
    openAccountSection();
};

/* Which providers to offer. A failure keeps what is on screen: the address book may be down, and GitHub is the one it always had. */
const loadProviders = async (): Promise<void> => {
    try {
        const client = await addressBookClient();
        usePulsarAccount.setState({ providers: offeredProviders(await client.providers()) });
    } catch {
        // Nothing to say: signing in says why if the address book is really gone.
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
    tokens = new AccessTokens(given.keeper, { onSignedOut: () => signedOut(null, sessionEnded()) });
    void loadProviders();
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

/*
 * `confirm` is for a sign-in started in the account section: the Remote pane opens with how it went.
 * A flow with a step of its own after signing in (approving a machine, picking one) leaves it off.
 */
export const signInToPulsar = async (provider: ProviderId = 'github', options: { confirm?: boolean } = {}): Promise<void> => {
    if (!platform || !tokens) {
        return;
    }
    const { web, redirect } = platform;
    const confirm = options.confirm === true;
    dismissAccountConfirmation();
    usePulsarAccount.setState({ status: 'signing-in', error: null, notice: null });
    if (web) {
        try {
            location.assign(
                await beginWebLogin(web.storage, { addressBookUrl: await platform.addressBook(), redirectUri: web.redirectUri, provider, confirm })
            );
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
            provider,
            label: currentClientLabel()
        });
        tokens.set(view);
        usePulsarAccount.setState({ status: 'signed-in', account: view.account, error: null });
        if (confirm) {
            confirmAccount(signedInConfirmation(provider, view.account));
            openAccountSection();
        }
    } catch (e) {
        const { account } = usePulsarAccount.getState();
        usePulsarAccount.setState({ status: account ? 'signed-in' : 'signed-out', error: messageOf(e) });
        if (confirm) {
            openAccountSection();
        }
    }
};

/* The ways to sign in to this account, and how the account is shown now that they may have changed. */
export const refreshPulsarIdentities = async (): Promise<void> => {
    try {
        applyAccountResult(await withAccessToken((client, token) => client.account(token)));
    } catch (e) {
        usePulsarAccount.setState({ error: messageOf(e) });
    }
};

/*
 * Adds a provider to the signed-in account. The link token is asked for with this session and the code
 * is traded with it again, so the new identity can only land on the account that is signed in here. The
 * web client leaves the page for the provider and finishes in `finishWebLink` when it comes back.
 */
export const linkPulsarProvider = async (provider: ProviderId): Promise<void> => {
    if (!platform || !tokens) {
        return;
    }
    const { web, redirect } = platform;
    dismissAccountConfirmation();
    usePulsarAccount.setState({ linking: provider, error: null });
    const requestLink = async (): Promise<string> => (await withAccessToken((client, token) => client.startIdentityLink(token, { provider }))).linkToken;
    try {
        const addressBookUrl = await platform.addressBook();
        if (web) {
            location.assign(await beginWebLogin(web.storage, { addressBookUrl, redirectUri: web.redirectUri, provider, link: await requestLink() }));
            return;
        }
        if (!redirect) {
            usePulsarAccount.setState({ linking: null });
            return;
        }
        applyAccountResult(await linkIdentity({ redirect, addressBookUrl, provider, requestLink, complete: completeLink }));
        confirmAccount(linkedConfirmation(provider));
        openAccountSection();
    } catch (e) {
        usePulsarAccount.setState({ linking: null, error: messageOf(e) });
        openAccountSection();
    }
};

/* Removes a provider from the account; the address book refuses the last one. */
export const unlinkPulsarProvider = async (provider: ProviderId): Promise<void> => {
    try {
        applyAccountResult(await withAccessToken((client, token) => client.unlinkIdentity(token, provider)));
    } catch (e) {
        usePulsarAccount.setState({ error: messageOf(e) });
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
    dismissAccountConfirmation();
    signedOut(null);
};

const addressBookClient = (): Promise<AddressBookClient> => {
    if (!platform) {
        return Promise.reject(new Error(i18next.t('machines:account.signInUnavailable')));
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
        throw new Error(i18next.t('machines:account.signInFirst'));
    }
    try {
        return await call(client, token);
    } catch (e) {
        if (!(e instanceof AddressBookRequestError) || e.code !== 'unauthorized') {
            throw e;
        }
        const fresh = await tokens?.refreshNow();
        if (!fresh) {
            throw new Error(i18next.t('machines:account.sessionEnded'));
        }
        return call(client, fresh);
    }
};
