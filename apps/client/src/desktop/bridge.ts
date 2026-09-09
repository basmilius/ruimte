/* The shell's API, present only inside the desktop app. Mirrors `apps/desktop/src/preload.ts`. */
export interface DesktopBridge {
    platform: string;
    pickFolder(initialPath?: string): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    openGuestDevTools(webContentsId: number): void;
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
