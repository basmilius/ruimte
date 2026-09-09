import { create } from 'zustand';

interface UiStore {
    paletteOpen: boolean;
    /* Text the palette opens with; a path puts it straight into folder browsing. */
    paletteSeed: string;
    settingsOpen: boolean;
    openPalette(seed?: string): void;
    setPaletteOpen(open: boolean): void;
    setSettingsOpen(open: boolean): void;
}

/* Which app-level dialog is up; nothing here belongs to a project or a node. */
export const useUi = create<UiStore>((set) => ({
    paletteOpen: false,
    paletteSeed: '',
    settingsOpen: false,
    openPalette(seed = '') {
        set({ paletteOpen: true, paletteSeed: seed });
    },
    setPaletteOpen(open) {
        set(open ? { paletteOpen: true, paletteSeed: '' } : { paletteOpen: false });
    },
    setSettingsOpen(open) {
        set({ settingsOpen: open });
    }
}));
