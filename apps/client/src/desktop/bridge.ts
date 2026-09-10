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

// Where macOS puts the traffic lights (see the shell), plus the gap the sidebar keeps after them.
export const TRAFFIC_LIGHTS_INSET_PX = 76;

/* True when the window controls sit over the top right of the window, which Windows and Linux do. */
export const hasOverlayControls = (): boolean => {
    const bridge = desktop();
    return bridge !== null && bridge.platform !== 'darwin';
};
