import { create } from 'zustand';

interface ServerStore {
    /* The daemon's platform (`darwin`, `win32`, `linux`); null until the first hello. */
    platform: string | null;
    home: string | null;
    version: string | null;
    /* How the daemon names itself and how far away it is, from `endpoint.info`. */
    label: string | null;
    reachability: 'loopback' | 'lan' | 'tunnel' | 'public' | null;
    setInfo(info: { platform: string; home: string; version: string }): void;
    setEndpoint(info: { label: string; reachability: 'loopback' | 'lan' | 'tunnel' | 'public' }): void;
}

export const useServer = create<ServerStore>((set) => ({
    platform: null,
    home: null,
    version: null,
    label: null,
    reachability: null,
    setInfo(info) {
        set(info);
    },
    setEndpoint(info) {
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
