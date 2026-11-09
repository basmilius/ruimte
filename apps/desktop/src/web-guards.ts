import type { NavigationVerdict } from '@adecore/shell';
import { EXTENSION_FILES_PATH, VISUAL_HOST_PATH } from '@ruimte/csp';

/*
 * What the shell lets a page do, as pure decisions, so `entry.ts` only wires them to Electron's events.
 * The app's page carries the whole bridge (the local secret included) and a browser node carries any
 * site on the web, so each rule here is a security boundary.
 */

export { isExternalLink, isWebLink } from '@adecore/shell';

// The partitions a `<webview>` may name: a browser node's (`apps/client/src/browser/registry.ts`), a sealed preview's and a tunnel's that the shell made.
export const BROWSER_PARTITION = 'persist:ruimte';
export const PREVIEW_PARTITION = 'preview';

/* The in-memory partition of a shared port opened as a page (`port-tunnel/tunnel-session.ts`); no `persist:`, so nothing stays on disk. */
export const TUNNEL_PARTITION_PREFIX = 'ruimte-port-';

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

/* A page an extension draws in a frame of its own, from its own files. */
function isExtensionFrame(url: string, isAppUrl: (url: string) => boolean): boolean {
    return isAppUrl(url) && (URL.parse(url)?.pathname ?? '').startsWith(EXTENSION_FILES_PATH);
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
 * link. A frame of the app's page shows a visual's sandbox host page, an extension's frame or an empty
 * document and nothing else, so an agent's page cannot take its frame anywhere, the app included. A frame inside an agent's
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
    return isVisualHost(url, isAppUrl) || isExtensionFrame(url, isAppUrl) ? 'allow' : 'refuse';
}

// TODO(Bas): media, location and notifications through a prompt per origin in the client, once that exists.
const GUEST_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);

/* What a page in a browser node gets without asking. Electron grants everything to a session without a handler. */
export function allowGuestPermission(permission: string): boolean {
    return GUEST_PERMISSIONS.has(permission);
}

/*
 * What the app's own page uses: notifications for agents, reading and writing the clipboard, full screen
 * from the menu, and the microphone for dictation and Voice (`media`, audio alone). A screen capture
 * reaches Electron as `display-capture` or as `media` with video.
 */
const APP_PERMISSIONS: ReadonlySet<string> = new Set(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);

export interface AppPermissionAsk {
    readonly permission: string;
    /* Whether the asking page is the main frame of one of the app's windows; a subframe (a visual, an extension's frame) never is. */
    readonly appMainFrame: boolean;
    readonly mediaTypes: readonly string[];
}

/* What the default session grants, refusing anything the app's page does not use and every subframe. */
export function allowAppPermission(ask: AppPermissionAsk): boolean {
    if (!ask.appMainFrame) {
        return false;
    }
    if (ask.permission === 'media') {
        return ask.mediaTypes.length === 1 && ask.mediaTypes[0] === 'audio';
    }

    return APP_PERMISSIONS.has(ask.permission);
}

/* The part of a `<webview>`'s preferences a guest could use to reach Node or another session, or to resize the app's window. */
export interface GuestWebPreferences {
    partition?: string;
    preload?: string;
    nodeIntegration?: boolean;
    nodeIntegrationInSubFrames?: boolean;
    contextIsolation?: boolean;
    sandbox?: boolean;
    disableHtmlFullscreenWindowResize?: boolean;
}

/*
 * Makes the preferences of a `<webview>` about to attach safe, in place, since that is how Electron
 * reads them back. False means the element names a session no guest belongs in, the app's own
 * included, and must not attach. A script in the page could otherwise ask for Node or a preload of
 * its own; the guest preload is registered on the session and survives this. A guest never sets the
 * window's full screen itself either, so leaving a video's full screen keeps the window as it was.
 */
export function hardenGuestPreferences(preferences: GuestWebPreferences, ownsTunnel: (partition: string) => boolean = () => false): boolean {
    const partition = preferences.partition;

    // A tunnel's partition is one the shell made for this very window, never a name an element chose.
    const tunnel = partition !== undefined && partition.startsWith(TUNNEL_PARTITION_PREFIX) && ownsTunnel(partition);

    if (partition !== BROWSER_PARTITION && partition !== PREVIEW_PARTITION && !tunnel) {
        return false;
    }
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    // Electron tells every guest when the app's page leaves HTML full screen, and a guest that was never
    // in it does not know the window already was, so it would take the window out of full screen. A guest
    // fills the screen through the app's page instead, which remembers how the window was.
    preferences.disableHtmlFullscreenWindowResize = true;
    return true;
}
