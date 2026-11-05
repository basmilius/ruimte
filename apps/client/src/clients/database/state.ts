import type { ExplorerSelection } from '@adecore/database';
import { create } from 'zustand';

export interface ConnectionsDialog {
    open: boolean;
    /* The connection the manager shows, or null for its first. */
    selected: string | null;
}

interface DatabasePanelStore {
    /* What the explorer has selected, which is where a new console runs when no tab says. */
    selection: ExplorerSelection | null;
    dialog: ConnectionsDialog;
    /* A project that opens starts from nothing selected and the dialog closed. */
    reset(): void;
    setSelection(selection: ExplorerSelection | null): void;
    openConnections(selected?: string | null): void;
    setConnectionsOpen(open: boolean): void;
    selectConnection(id: string | null): void;
}

/*
 * The explorer's selection and the connections dialog. The tables, structures and designers a person
 * opens are loose views in a tab host (`state/files.ts`, `database/tabs.ts`).
 */
export const useDatabasePanel = create<DatabasePanelStore>((set, get) => ({
    selection: null,
    dialog: { open: false, selected: null },
    reset() {
        set({ selection: null, dialog: { open: false, selected: null } });
    },
    setSelection(selection) {
        set({ selection });
    },
    openConnections(selected = null) {
        set({ dialog: { open: true, selected } });
    },
    setConnectionsOpen(open) {
        set({ dialog: { ...get().dialog, open } });
    },
    selectConnection(id) {
        set({ dialog: { ...get().dialog, selected: id } });
    }
}));
