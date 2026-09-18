import { create } from 'zustand';
import type { DeviceInfo, DeviceReference } from '@ruimte/contracts';

export interface DeviceListState {
    devices: DeviceInfo[];
    loaded: boolean;
    loading: boolean;
    error: string | null;
}

export const EMPTY_DEVICE_LIST: DeviceListState = { devices: [], loaded: false, loading: false, error: null };

interface DevicesState {
    byEndpoint: Record<string, DeviceListState>;
    setLoading(endpointId: string): void;
    receive(endpointId: string, devices: DeviceInfo[]): void;
    fail(endpointId: string, error: string): void;
    patch(endpointId: string, device: DeviceInfo): void;
    forget(endpointId: string): void;
}

export const useDevices = create<DevicesState>((set, get) => ({
    byEndpoint: {},
    setLoading(endpointId) {
        const current = get().byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, loading: true, error: null } } });
    },
    receive(endpointId, devices) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { devices, loaded: true, loading: false, error: null } } });
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

export const deviceMatches = (device: DeviceInfo, reference: DeviceReference): boolean =>
    device.platform === reference.platform && device.kind === reference.kind && device.name === reference.name && device.runtime === reference.runtime;

export const useDeviceList = (endpointId: string): DeviceListState => useDevices((state) => state.byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST);

export const useResolvedDevice = (endpointId: string, reference: DeviceReference | undefined): DeviceInfo | null =>
    useDevices((state) => (reference ? (state.byEndpoint[endpointId]?.devices.find((device) => deviceMatches(device, reference)) ?? null) : null));
