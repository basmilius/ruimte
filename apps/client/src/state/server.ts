import { create } from 'zustand';

interface ServerStore {
    /* The daemon's platform (`darwin`, `win32`, `linux`); null until the first hello. */
    platform: string | null;
    home: string | null;
    setInfo(info: { platform: string; home: string }): void;
}

export const useServer = create<ServerStore>((set) => ({
    platform: null,
    home: null,
    setInfo(info) {
        set(info);
    }
}));

/* What the daemon's machine calls its file manager; the daemon runs it, so its platform decides. */
export const fileManagerName = (platform: string | null): string => {
    switch (platform) {
        case 'darwin':
            return 'Finder';
        case 'win32':
            return 'Explorer';
        default:
            return 'Files';
    }
};
