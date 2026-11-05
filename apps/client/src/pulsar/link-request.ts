import { DEVICE_LINK_LIFETIME_MS, USER_CODE_LENGTH } from '@ruimte/pulsar';
import { z } from 'zod';
import { create } from 'zustand';
import { storedJson } from '@/state/stored-json';
import type { AccountStatus } from '@/station';
import type { LoginStorage } from './web';

/*
 * A person approving a machine that ran `ruimte login`. The terminal points at `/link` on the web
 * client, with the code in the query; the page may have to leave for GitHub first, so the request is
 * written down until the dialog closes or the code could not work any more.
 */

const LINK_PATH = '/link';

const PENDING_LINK_KEY = 'ruimte.pulsar.pendingLink';

const PendingLinkSchema = z.object({ code: z.string().max(32).nullable(), openedAt: z.number() });
type PendingLink = z.infer<typeof PendingLinkSchema>;

const storedPendingLink = storedJson(PENDING_LINK_KEY, PendingLinkSchema);

/* The code a `/link` address carries, `{ code: null }` for the page without one, or null for any other page. */
export function linkRequestOf(pathname: string, search: string): { code: string | null } | null {
    if (pathname.replace(/\/+$/, '') !== LINK_PATH) {
        return null;
    }
    const code = new URLSearchParams(search).get('code');
    return { code: code === null ? null : typedCode(code) };
}

export function rememberLink(storage: LoginStorage, code: string | null, now = Date.now()): void {
    storage.setItem(PENDING_LINK_KEY, JSON.stringify({ code, openedAt: now } satisfies PendingLink));
}

/* The request a page left for GitHub with, until no code it carries could still be waiting. */
export function rememberedLink(storage: LoginStorage, now = Date.now()): PendingLink | null {
    const pending = storedPendingLink.read(storage);
    if (pending === null || now - pending.openedAt > DEVICE_LINK_LIFETIME_MS) {
        storage.removeItem(PENDING_LINK_KEY);
        return null;
    }
    return pending;
}

export function forgetLink(storage: LoginStorage): void {
    storage.removeItem(PENDING_LINK_KEY);
}

/*
 * What a person typed, shaped the way the terminal prints it: letters only, upper case, a dash after
 * the fourth. A letter the code never uses stays, so the lookup can say it is not a code rather than
 * the field swallowing a key without a word.
 */
export function typedCode(input: string): string {
    const letters = input
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, USER_CODE_LENGTH);
    return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

type LinkStep = 'unavailable' | 'sign-in' | 'signing-in' | 'enter-code' | 'confirm' | 'added' | 'denied';

interface LinkStepInput {
    accountStatus: AccountStatus;
    // A machine the code was looked up for, waiting for a yes or a no.
    lookedUp: boolean;
    outcome: 'added' | 'denied' | null;
}

/* Which part of the dialog stands: an outcome first, then the account, then the code. */
export function linkStep(input: LinkStepInput): LinkStep {
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
}

interface LinkRequestState {
    open: boolean;
    code: string | null;
}

/* The dialog the `/link` page opens, outside the settings: the web client may show it before any machine is picked. */
export const useLinkRequest = create<LinkRequestState>(() => ({ open: false, code: null }));

/* Once at boot: a `/link` address becomes the dialog, and so does one the page left for GitHub with. */
export function startLinkRequest(storage: LoginStorage = localStorage): void {
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
}

export function closeLinkRequest(storage: LoginStorage = localStorage): void {
    forgetLink(storage);
    useLinkRequest.setState({ open: false, code: null });
}
