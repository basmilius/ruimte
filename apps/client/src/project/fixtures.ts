import type { Endpoint } from '@/state/endpoints';

export function fakeStorage(storage: Map<string, string>) {
    return {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key)
    };
}

export function lanEndpoint(id: string, label: string = id): Endpoint {
    return { id, label, httpBaseUrl: `http://${id}`, wsBaseUrl: `ws://${id}`, reachability: 'lan', daemonId: id, daemonPublicKey: null };
}
