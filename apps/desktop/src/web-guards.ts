/*
 * What the shell lets a page do, as pure decisions, so `main.ts` only wires them to Electron's events.
 * The app's page carries the whole bridge (the local secret included) and a browser node carries any
 * site on the web, so each rule here is a security boundary.
 */

// The partitions a `<webview>` may name: a browser node's (`apps/client/src/browser/registry.ts`) and a sealed preview's.
export const BROWSER_PARTITION = 'persist:ruimte';
export const PREVIEW_PARTITION = 'preview';

/* The origin of a URL, or null for one that does not parse or has no origin of its own (`about:`, `data:`). */
export const originOf = (url: string): string | null => {
    try {
        const origin = new URL(url).origin;
        return origin === 'null' ? null : origin;
    } catch {
        return null;
    }
};

export const isAppUrl = (url: string, appOrigin: string): boolean => originOf(url) === appOrigin;

export const isWebLink = (url: string): boolean => /^https?:\/\//i.test(url);

/* What the system browser or mail app may be handed; a `file:` link could open an application. */
export const isExternalLink = (url: string): boolean => isWebLink(url) || /^mailto:/i.test(url);

/* The System Settings panes the app's page may open: the two grants computer use needs, and nothing a URL could smuggle beside them. */
const SYSTEM_SETTINGS_PANES: ReadonlySet<string> = new Set([
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
]);

export const isSystemSettingsPane = (url: string): boolean => SYSTEM_SETTINGS_PANES.has(url);

export type NavigationVerdict = 'allow' | 'external' | 'refuse';

/*
 * Where the app window's own page may go. A dropped link or file navigates the top frame, and the page
 * it lands on would inherit the bridge, so only the app stays in the window and a web link leaves for
 * the system browser.
 */
export const appWindowNavigation = (url: string, appOrigin: string): NavigationVerdict => {
    if (isAppUrl(url, appOrigin)) {
        return 'allow';
    }
    return isWebLink(url) ? 'external' : 'refuse';
};

/* A frame inside the app's page never leaves for the system browser: nobody chose that link. */
export const appSubframeNavigation = (url: string, appOrigin: string): NavigationVerdict =>
    isAppUrl(url, appOrigin) || url === 'about:blank' || url === 'about:srcdoc' ? 'allow' : 'refuse';

/* The part of an IPC event's sender frame the check reads. */
export interface SenderFrame {
    readonly url: string;
    readonly parent: unknown;
}

/*
 * Whether an IPC message came from the app itself: the top frame of the app window, still on the app's
 * origin. The web contents alone says nothing, since it stays the same object whatever it navigates to.
 */
export const isAppSender = (isAppWindow: boolean, frame: SenderFrame | null, appOrigin: string): boolean =>
    isAppWindow && frame !== null && frame.parent === null && isAppUrl(frame.url, appOrigin);

// TODO(Bas): media, location and notifications through a prompt per origin in the client, once that exists.
const GUEST_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);

/* What a page in a browser node gets without asking. Electron grants everything to a session without a handler. */
export const allowGuestPermission = (permission: string): boolean => GUEST_PERMISSIONS.has(permission);

/* The part of a `<webview>`'s preferences a guest could use to reach Node or another session. */
export interface GuestWebPreferences {
    partition?: string;
    preload?: string;
    nodeIntegration?: boolean;
    nodeIntegrationInSubFrames?: boolean;
    contextIsolation?: boolean;
    sandbox?: boolean;
}

/*
 * Makes the preferences of a `<webview>` about to attach safe, in place, since that is how Electron
 * reads them back. False means the element names a session no guest belongs in, the app's own
 * included, and must not attach. A script in the page could otherwise ask for Node or a preload of
 * its own; the guest preload is registered on the session and survives this.
 */
export const hardenGuestPreferences = (preferences: GuestWebPreferences): boolean => {
    if (preferences.partition !== BROWSER_PARTITION && preferences.partition !== PREVIEW_PARTITION) {
        return false;
    }
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    return true;
};
