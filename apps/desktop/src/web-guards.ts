import { isAppUrl, type NavigationVerdict } from '@basmilius/desktop-shell';

/*
 * What the shell lets a page do, as pure decisions, so `main.ts` only wires them to Electron's events.
 * The app's page carries the whole bridge (the local secret included) and a browser node carries any
 * site on the web, so each rule here is a security boundary. The rules every app shares are
 * `@basmilius/desktop-shell`'s and pass through here, so `main.ts` has one place to ask.
 */

export {
    appWindowNavigation,
    isAppSender,
    isAppUrl,
    isExternalLink,
    isWebLink,
    originOf,
    type NavigationVerdict,
    type SenderFrame
} from '@basmilius/desktop-shell';

// The partitions a `<webview>` may name: a browser node's (`apps/client/src/browser/registry.ts`) and a sealed preview's.
export const BROWSER_PARTITION = 'persist:ruimte';
export const PREVIEW_PARTITION = 'preview';

/* The System Settings panes the app's page may open: the two grants computer use needs, and nothing a URL could smuggle beside them. */
const SYSTEM_SETTINGS_PANES: ReadonlySet<string> = new Set([
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
]);

export const isSystemSettingsPane = (url: string): boolean => SYSTEM_SETTINGS_PANES.has(url);

/* A frame inside the app's page never leaves for the system browser: nobody chose that link. */
export const appSubframeNavigation = (url: string, appOrigin: string): NavigationVerdict =>
    isAppUrl(url, appOrigin) || url === 'about:blank' || url === 'about:srcdoc' ? 'allow' : 'refuse';

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
