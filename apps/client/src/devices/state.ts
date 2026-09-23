import { create } from 'zustand';
import { deviceMatches, type DeviceInfo, type DeviceReference, type DeviceUnavailable } from '@ruimte/contracts';

export interface DeviceListState {
    devices: DeviceInfo[];
    unavailable: DeviceUnavailable[];
    loaded: boolean;
    loading: boolean;
    error: string | null;
}

export const EMPTY_DEVICE_LIST: DeviceListState = { devices: [], unavailable: [], loaded: false, loading: false, error: null };

const COLLAPSED_STORAGE_KEY = 'ruimte.devices.collapsed';

const readCollapsedGroups = (): readonly string[] => {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? '[]');
        return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : [];
    } catch {
        return [];
    }
};

const persistCollapsedGroups = (keys: readonly string[]): void => {
    try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(keys));
    } catch {
        // Storage that refuses keeps the choice for this session only.
    }
};

interface DevicesState {
    byEndpoint: Record<string, DeviceListState>;
    /* The groups of the devices panel a person folded away, on every machine alike. */
    collapsedGroups: readonly string[];
    collapseGroup(key: string, collapsed: boolean): void;
    setLoading(endpointId: string): void;
    receive(endpointId: string, devices: DeviceInfo[], unavailable: DeviceUnavailable[]): void;
    fail(endpointId: string, error: string): void;
    patch(endpointId: string, device: DeviceInfo): void;
    forget(endpointId: string): void;
}

export const useDevices = create<DevicesState>((set, get) => ({
    byEndpoint: {},
    collapsedGroups: readCollapsedGroups(),
    collapseGroup(key, collapsed) {
        const others = get().collapsedGroups.filter((candidate) => candidate !== key);
        const collapsedGroups = collapsed ? [...others, key] : others;
        persistCollapsedGroups(collapsedGroups);
        set({ collapsedGroups });
    },
    setLoading(endpointId) {
        const current = get().byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, loading: true, error: null } } });
    },
    receive(endpointId, devices, unavailable) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { devices, unavailable, loaded: true, loading: false, error: null } } });
    },
    fail(endpointId, error) {
        const current = get().byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, loaded: true, loading: false, error } } });
    },
    patch(endpointId, device) {
        const current = get().byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST;
        const devices = current.devices.some((candidate) => sameDevice(candidate, device))
            ? current.devices.map((candidate) => (sameDevice(candidate, device) ? device : candidate))
            : [...current.devices, device];
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, devices, error: null } } });
    },
    forget(endpointId) {
        const { [endpointId]: _removed, ...byEndpoint } = get().byEndpoint;
        set({ byEndpoint });
    }
}));

export const sameDevice = (left: Pick<DeviceInfo, 'backendId' | 'deviceId'>, right: Pick<DeviceInfo, 'backendId' | 'deviceId'>): boolean =>
    left.backendId === right.backendId && left.deviceId === right.deviceId;

// Re-exported, since what a reference points at is one rule and the daemon answers it too.
export { deviceMatches };

export const useDeviceList = (endpointId: string): DeviceListState => useDevices((state) => state.byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST);

export const useResolvedDevice = (endpointId: string, reference: DeviceReference | undefined): DeviceInfo | null =>
    useDevices((state) => (reference ? (state.byEndpoint[endpointId]?.devices.find((device) => deviceMatches(device, reference)) ?? null) : null));
