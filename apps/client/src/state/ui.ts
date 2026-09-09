import { create } from 'zustand';

export type SettingsSectionId = 'appearance' | 'canvas' | 'agents' | 'machines' | 'keyboard' | 'about';

export interface SettingsState {
    open: boolean;
    /* The section the dialog shows; it stays where it was so reopening lands on the same pane. */
    section: SettingsSectionId;
}

interface UiStore {
    paletteOpen: boolean;
    /* Text the palette opens with; a path puts it straight into folder browsing. */
    paletteSeed: string;
    settings: SettingsState;
    layoutDialogOpen: boolean;
    /* The group a worktree is being bound to, while its dialog is up. */
    worktreeDialogFor: string | null;
    setWorktreeDialogFor(groupId: string | null): void;
    openPalette(seed?: string): void;
    setLayoutDialogOpen(open: boolean): void;
    setPaletteOpen(open: boolean): void;
    setSettings(patch: Partial<SettingsState>): void;
}

/* Which app-level dialog is up; nothing here belongs to a project or a node. */
export const useUi = create<UiStore>((set, get) => ({
    paletteOpen: false,
    paletteSeed: '',
    settings: { open: false, section: 'appearance' },
    layoutDialogOpen: false,
    worktreeDialogFor: null,
    setWorktreeDialogFor(groupId) {
        set({ worktreeDialogFor: groupId });
    },
    setLayoutDialogOpen(open) {
        set({ layoutDialogOpen: open });
    },
    openPalette(seed = '') {
        set({ paletteOpen: true, paletteSeed: seed });
    },
    setPaletteOpen(open) {
        set(open ? { paletteOpen: true, paletteSeed: '' } : { paletteOpen: false });
    },
    setSettings(patch) {
        set({ settings: { ...get().settings, ...patch } });
    }
}));
