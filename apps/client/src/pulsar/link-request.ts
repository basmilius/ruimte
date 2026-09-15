import { z } from 'zod';
import { create } from 'zustand';
import { DEVICE_LINK_LIFETIME_MS, USER_CODE_LENGTH } from '@ruimte/pulsar';
import type { AccountStatus } from './account';
import type { LoginStorage } from './web';

/*
 * A person approving a machine that ran `ruimte login`. The terminal points at `/link` on the web
 * client, with the code in the query; the page may have to leave for GitHub first, so the request is
 * written down until the dialog closes or the code could not work any more.
 */

export const LINK_PATH = '/link';

const PENDING_LINK_KEY = 'ruimte.pulsar.pendingLink';

const PendingLinkSchema = z.object({ code: z.string().max(32).nullable(), openedAt: z.number() });
export type PendingLink = z.infer<typeof PendingLinkSchema>;

/* The code a `/link` address carries, `{ code: null }` for the page without one, or null for any other page. */
export const linkRequestOf = (pathname: string, search: string): { code: string | null } | null => {
    if (pathname.replace(/\/+$/, '') !== LINK_PATH) {
        return null;
    }
    const code = new URLSearchParams(search).get('code');
    return { code: code === null ? null : typedCode(code) };
};

export const rememberLink = (storage: LoginStorage, code: string | null, now = Date.now()): void => {
    storage.setItem(PENDING_LINK_KEY, JSON.stringify({ code, openedAt: now } satisfies PendingLink));
};

/* The request a page left for GitHub with, until no code it carries could still be waiting. */
export const rememberedLink = (storage: LoginStorage, now = Date.now()): PendingLink | null => {
    const raw = storage.getItem(PENDING_LINK_KEY);
    if (raw === null) {
        return null;
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        parsed = null;
    }
    const pending = PendingLinkSchema.safeParse(parsed);
    if (!pending.success || now - pending.data.openedAt > DEVICE_LINK_LIFETIME_MS) {
        storage.removeItem(PENDING_LINK_KEY);
        return null;
    }
    return pending.data;
};

export const forgetLink = (storage: LoginStorage): void => {
    storage.removeItem(PENDING_LINK_KEY);
};

/*
 * What a person typed, shaped the way the terminal prints it: letters only, upper case, a dash after
 * the fourth. A letter the code never uses stays, so the lookup can say it is not a code rather than
 * the field swallowing a key without a word.
 */
export const typedCode = (input: string): string => {
    const letters = input
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, USER_CODE_LENGTH);
    return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
};

export type LinkStep = 'unavailable' | 'sign-in' | 'signing-in' | 'enter-code' | 'confirm' | 'added' | 'denied';

export interface LinkStepInput {
    accountStatus: AccountStatus;
    // A machine the code was looked up for, waiting for a yes or a no.
    lookedUp: boolean;
    outcome: 'added' | 'denied' | null;
}

/* Which part of the dialog stands: an outcome first, then the account, then the code. */
export const linkStep = (input: LinkStepInput): LinkStep => {
    if (input.outcome !== null) {
        return input.outcome;
    }
    switch (input.accountStatus) {
        case 'unavailable':
            return 'unavailable';
        case 'signed-out':
            return 'sign-in';
        case 'loading':
        case 'signing-in':
            return 'signing-in';
        case 'signed-in':
            return input.lookedUp ? 'confirm' : 'enter-code';
    }
};

interface LinkRequestState {
    open: boolean;
    code: string | null;
}

/* The dialog the `/link` page opens, outside the settings: the web client may show it before any machine is picked. */
export const useLinkRequest = create<LinkRequestState>(() => ({ open: false, code: null }));

/* Once at boot: a `/link` address becomes the dialog, and so does one the page left for GitHub with. */
export const startLinkRequest = (storage: LoginStorage = localStorage): void => {
    const arrived = linkRequestOf(location.pathname, location.search);
    if (arrived !== null) {
        rememberLink(storage, arrived.code);
        // The code leaves the address bar, so a reload or a screenshot carries none.
        history.replaceState(null, '', '/');
    }
    const pending = rememberedLink(storage);
    if (pending !== null) {
        useLinkRequest.setState({ open: true, code: pending.code });
    }
};

export const closeLinkRequest = (storage: LoginStorage = localStorage): void => {
    forgetLink(storage);
    useLinkRequest.setState({ open: false, code: null });
};
