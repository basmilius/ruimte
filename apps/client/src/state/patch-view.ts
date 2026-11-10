import { create } from 'zustand';
import { storedText } from '@/state/stored-json';

const storedMode = storedText('ruimte.patch-view');

type PatchViewMode = 'patch' | 'text';

export function readMode(): PatchViewMode {
    return storedMode.read() === 'text' ? 'text' : 'patch';
}

interface PatchViewStore {
    mode: PatchViewMode;
    setMode(mode: PatchViewMode): void;
}

/* How `.patch` and `.diff` files open on this client: as a patch, or as the plain text. Never part of a project. */
export const usePatchView = create<PatchViewStore>((set) => ({
    mode: readMode(),
    setMode(mode) {
        storedMode.write(mode);
        set({ mode });
    }
}));
