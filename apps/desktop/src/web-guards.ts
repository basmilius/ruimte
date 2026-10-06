import type { NavigationVerdict } from '@adecore/shell';
import { VISUAL_HOST_PATH } from '@ruimte/csp';

/*
 * What the shell lets a page do, as pure decisions, so `main.ts` only wires them to Electron's events.
 * The app's page carries the whole bridge (the local secret included) and a browser node carries any
 * site on the web, so each rule here is a security boundary. The rules every app shares are
 * `@adecore/shell`'s and pass through here, so `main.ts` has one place to ask.
 */

export { appWindowNavigation, isAppSender, isAppUrl, isExternalLink, isWebLink, originOf, type NavigationVerdict, type SenderFrame } from '@adecore/shell';

// The partitions a `<webview>` may name: a browser node's (`apps/client/src/browser/registry.ts`) and a sealed preview's.
export const BROWSER_PARTITION = 'persist:ruimte';
export const PREVIEW_PARTITION = 'preview';

/* The System Settings panes the app's page may open: the two grants computer use needs, and nothing a URL could smuggle beside them. */
const SYSTEM_SETTINGS_PANES: ReadonlySet<string> = new Set([
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
]);

export function isSystemSettingsPane(url: string): boolean {
    return SYSTEM_SETTINGS_PANES.has(url);
}

/* The part of a frame the guards read, up through its parents. */
export interface FrameInPage {
    readonly url: string;
    readonly parent: FrameInPage | null;
}

function isEmptyDocument(url: string): boolean {
    return url === 'about:blank' || url === 'about:srcdoc';
}

function isVisualHost(url: string, isAppUrl: (url: string) => boolean): boolean {
    return isAppUrl(url) && URL.parse(url)?.pathname === VISUAL_HOST_PATH;
}

/* Whether the frame sits inside a visual: below a frame of the app's page that shows the sandbox host page. */
function insideVisual(frame: FrameInPage | null, isAppUrl: (url: string) => boolean): boolean {
    const chain: FrameInPage[] = [];
    for (let at = frame; at !== null; at = at.parent) {
        chain.push(at);
    }
    // The frame, the frame of the app's page it is in, and that page.
    return chain.length > 2 && isVisualHost(chain[chain.length - 2]!.url, isAppUrl);
}

/*
 * Where a frame inside the app's page may go, which is never the system browser: nobody chose that
 * link. A frame of the app's page shows a visual's sandbox host page or an empty document and nothing
 * else, so an agent's page cannot take its frame anywhere, the app included. A frame inside an agent's
 * page loads the web as the host page's policy lets it, and never the app. A frame Electron no longer
 * knows gets the stricter rule.
 */
export function appSubframeNavigation(url: string, frame: FrameInPage | null, isAppUrl: (url: string) => boolean): NavigationVerdict {
    if (isEmptyDocument(url)) {
        return 'allow';
    }
    if (insideVisual(frame, isAppUrl)) {
        return /^(https|data|blob):/i.test(url) && !isAppUrl(url) ? 'allow' : 'refuse';
    }
    return isVisualHost(url, isAppUrl) ? 'allow' : 'refuse';
}

// TODO(Bas): media, location and notifications through a prompt per origin in the client, once that exists.
const GUEST_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);

/* What a page in a browser node gets without asking. Electron grants everything to a session without a handler. */
export function allowGuestPermission(permission: string): boolean {
    return GUEST_PERMISSIONS.has(permission);
}

/* What a person does on purpose: a press or a key, never a move, a wheel or a scroll. */
const DELIBERATE_INPUT: ReadonlySet<string> = new Set(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'gestureTap', 'touchEnd']);

/* How long after a press a link may still leave, which is longer than any click takes to navigate. */
export const GESTURE_MS = 1000;

/*
 * Whether a link a sealed preview wants to open in the system browser follows a press of the person.
 * The preview runs the file's scripts, and without this a cloned repository's page could send the
 * person's browser anywhere, over and over. One press lets one link out.
 */
export function createGestureGate(now: () => number) {
    let pressedAt: number | null = null;
    return {
        saw(type: string): void {
            if (DELIBERATE_INPUT.has(type)) {
                pressedAt = now();
            }
        },
        consume(): boolean {
            const recent = pressedAt !== null && now() - pressedAt <= GESTURE_MS;
            pressedAt = null;
            return recent;
        }
    };
}

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
export function hardenGuestPreferences(preferences: GuestWebPreferences): boolean {
    if (preferences.partition !== BROWSER_PARTITION && preferences.partition !== PREVIEW_PARTITION) {
        return false;
    }
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    return true;
}
