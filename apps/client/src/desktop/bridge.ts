/* The shell's API, present only inside the desktop app. Mirrors `apps/desktop/src/preload.ts`. */
export interface DesktopBridge {
    platform: string;
    pickFolder(initialPath?: string): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    openGuestDevTools(webContentsId: number): void;
    isFullscreen(): Promise<boolean>;
    onFullscreen(listener: (fullscreen: boolean) => void): () => void;
    setTitleBarTheme(dark: boolean): void;
}

declare global {
    interface Window {
        ruimteDesktop?: DesktopBridge;
    }
}

export const desktop = (): DesktopBridge | null => (typeof window === 'undefined' ? null : (window.ruimteDesktop ?? null));

export const isDesktop = (): boolean => desktop() !== null;

/* True when the window chrome leaves room for the traffic lights, which only macOS does. */
export const hasTrafficLights = (): boolean => desktop()?.platform === 'darwin';

/* The traffic lights end 64px in (12px from the edge, then three 12px buttons 8px apart, see the
   shell), and the first control starts 20px after that, so the lights read as their own group. */
export const TRAFFIC_LIGHTS_INSET_PX = 84;

/* True on macOS, in the desktop app and in a browser tab alike. Chords differ there: Ctrl+B is
   readline's backward-char and tmux's prefix, while Cmd+B is free. */
export const isApplePlatform = (): boolean => {
    const bridge = desktop();
    if (bridge) {
        return bridge.platform === 'darwin';
    }
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
};

/* True when the window controls sit over the top right of the window, which Windows and Linux do. */
export const hasOverlayControls = (): boolean => {
    const bridge = desktop();
    return bridge !== null && bridge.platform !== 'darwin';
};
