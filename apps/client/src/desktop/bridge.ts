import type { DesktopBridge, MachineMode } from '@ruimte/desktop-bridge';
import { isApplePlatform as isApplePlatformFromNavigator } from '@adecore/ui';

export type {
    BrowserRouteBinding,
    BackgroundServiceBridge,
    BackgroundServiceState,
    BrowserContextAction,
    BrowserContextParams,
    DaemonCrash,
    DesktopBridge,
    KeepAwakeRequest,
    MachineMode,
    MachineStopPreview,
    OpenAiCredentialStatus,
    OpenAiLivePreferences,
    Release,
    ReleaseNotesState,
    SaveFileStreamBridge,
    SystemIdleState,
    UpdateState,
    WindowPoint
} from '@ruimte/desktop-bridge';

declare global {
    interface Window {
        ruimteDesktop?: DesktopBridge;
    }
}

export function desktop(): DesktopBridge | null {
    return typeof window === 'undefined' ? null : (window.ruimteDesktop ?? null);
}

export function isDesktop(): boolean {
    return desktop() !== null;
}

/* The system browser in the desktop app, a new tab elsewhere. */
export function openInSystemBrowser(url: string): void {
    const bridge = desktop();

    if (bridge) {
        void bridge.openExternal(url);
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

/* Null outside the desktop app. A shell from before the mode ran a machine, so it reads `local`. */
export function machineMode(): MachineMode | null {
    const bridge = desktop();
    return bridge === null ? null : (bridge.machine?.mode ?? 'local');
}

/* The desktop app on macOS for now; a browser is not offered the setting at all. */
export function canKeepAwake(): boolean {
    const bridge = desktop();
    return bridge?.platform === 'darwin' && (typeof bridge.requestKeepAwake === 'function' || typeof bridge.setKeepAwake === 'function');
}

/* A two-finger swipe goes back and forward in a page; elsewhere a mouse's side buttons do that. */
export function canSwipeBetweenPages(): boolean {
    return desktop()?.platform === 'darwin';
}

export function hasTrafficLights(): boolean {
    return desktop()?.platform === 'darwin';
}

/* The traffic lights end 64px in (12px from the edge, then three 12px buttons 8px apart, see the
   shell), and the first control starts 20px after that, so the lights read as their own group. */
export const TRAFFIC_LIGHTS_INSET_PX = 84;

/* In the desktop app and in a browser tab alike. Shortcuts differ there: Ctrl+B is readline's
   backward-char and tmux's prefix, while Cmd+B is free. */
export function isApplePlatform(): boolean {
    const bridge = desktop();
    return bridge ? bridge.platform === 'darwin' : isApplePlatformFromNavigator();
}

/* Windows hides its menu bar, so the logo at the top of the sidebar opens the application menu. */
export function hasLogoMenu(): boolean {
    return desktop()?.platform === 'win32';
}

/* Linux draws the window controls over the top right of the window; Windows has its own title bar. */
export function hasOverlayControls(): boolean {
    const bridge = desktop();
    return bridge !== null && bridge.platform === 'linux';
}
