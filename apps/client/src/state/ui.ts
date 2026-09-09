import { create } from 'zustand';

interface UiStore {
    paletteOpen: boolean;
    settingsOpen: boolean;
    setPaletteOpen(open: boolean): void;
    setSettingsOpen(open: boolean): void;
}

/* Which app-level dialog is up; nothing here belongs to a project or a node. */
export const useUi = create<UiStore>((set) => ({
    paletteOpen: false,
    settingsOpen: false,
    setPaletteOpen(open) {
        set({ paletteOpen: open });
    },
    setSettingsOpen(open) {
        set({ settingsOpen: open });
    }
}));
