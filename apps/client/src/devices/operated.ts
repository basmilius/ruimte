import i18next from 'i18next';
import { create } from 'zustand';
import type { DeviceAgentStep, DeviceControlMode, DeviceInfo, DeviceOperated, DevicePlatform } from '@ruimte/contracts';
import { pool } from '@/transport';
import { watchPool, type WatchablePool } from '@/transport/pool-watch';

type Target = Pick<DeviceInfo, 'backendId' | 'deviceId'>;

const keyOf = (device: Target): string => `${device.backendId}\u0000${device.deviceId}`;

interface DeviceOperatedState {
    /* Per machine, the devices an agent operates there now, by backend and device id. */
    byEndpoint: Record<string, Record<string, DeviceOperated>>;
    setAll(endpointId: string, devices: readonly DeviceOperated[]): void;
    receive(endpointId: string, operated: DeviceOperated): void;
    forget(endpointId: string): void;
}

export const useDeviceOperated = create<DeviceOperatedState>((set, get) => ({
    byEndpoint: {},
    setAll(endpointId, devices) {
        const live = Object.fromEntries(devices.filter((entry) => entry.state !== 'ended').map((entry) => [keyOf(entry), entry]));
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: live } });
    },
    receive(endpointId, operated) {
        const { [keyOf(operated)]: _before, ...others } = get().byEndpoint[endpointId] ?? {};
        const next = operated.state === 'ended' ? others : { ...others, [keyOf(operated)]: operated };
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: next } });
    },
    forget(endpointId) {
        const { [endpointId]: _removed, ...byEndpoint } = get().byEndpoint;
        set({ byEndpoint });
    }
}));

/* How an agent operates this device of the machine now; null while none does. */
export const operatedOf = (state: Pick<DeviceOperatedState, 'byEndpoint'>, endpointId: string, device: Target | null): DeviceOperated | null =>
    device ? (state.byEndpoint[endpointId]?.[keyOf(device)] ?? null) : null;

export const useOperatedDevice = (endpointId: string, device: Target | null): DeviceOperated | null =>
    useDeviceOperated((s) => operatedOf(s, endpointId, device));

/* Android names three of the buttons its own way, as the node's controls do. */
const ANDROID_BUTTONS: Readonly<Record<string, string>> = { appSwitcher: 'recentApps', lock: 'power', siri: 'assistant' };

const BUTTONS: ReadonlySet<string> = new Set(['home', 'back', 'swipeHome', 'appSwitcher', 'recentApps', 'lock', 'power', 'siri', 'assistant']);

/* What the agent is doing, in the words of the strip; a kind this client does not know reads as the machine said it. */
export const stepWords = (step: DeviceAgentStep, platform: DevicePlatform): string => {
    switch (step.kind) {
        case 'tap':
        case 'swipe':
        case 'type':
        case 'shot':
            return i18next.t(`machines:device.operated.step.${step.kind}`);
        case 'launch':
            return i18next.t('machines:device.operated.step.launch', { app: step.target ?? '' });
        case 'button': {
            const button = step.target ?? '';
            const named = platform === 'android' ? (ANDROID_BUTTONS[button] ?? button) : button;
            return BUTTONS.has(named) ? i18next.t(`machines:device.operated.button.${named}`) : i18next.t('machines:device.operated.step.button', { button });
        }
        default:
            return step.description;
    }
};

export interface StripLook {
    /* What the agent is doing, or that the person holds the device. */
    words: string;
    // The accent while the agent acts, muted while the person holds the device, as the Mac's indicator.
    tone: 'accent' | 'muted';
    actions: readonly DeviceControlMode[];
}

export const stripLook = (operated: DeviceOperated, platform: DevicePlatform): StripLook => {
    if (operated.state === 'paused') {
        return { words: i18next.t('machines:device.operated.paused'), tone: 'muted', actions: ['resume'] };
    }
    if (operated.state === 'takenOver') {
        return { words: i18next.t('machines:device.operated.takenOver'), tone: 'muted', actions: ['resume'] };
    }
    return {
        words: operated.step ? stepWords(operated.step, platform) : i18next.t('machines:device.operated.working'),
        tone: 'accent',
        actions: ['pause', 'takeOver']
    };
};

/*
 * Where a tap of the agent lands on the drawn screen, in pixels of the box the screen sits in; null for
 * any other step. `screen` is the drawn screen inside that box, which shows the whole frame.
 */
export const tapPoint = (
    step: DeviceAgentStep | null,
    screen: { left: number; top: number; width: number; height: number }
): { x: number; y: number } | null => {
    if (step?.kind !== 'tap' || step.x === undefined || step.y === undefined) {
        return null;
    }
    return { x: Math.round(screen.left + step.x * screen.width), y: Math.round(screen.top + step.y * screen.height) };
};

/*
 * The devices agents operate on every machine this client holds a socket for. The daemon tells every
 * socket each step and change; a socket that opens asks for the standing answer once.
 */
export const startDeviceOperatedWatch = (source: WatchablePool = pool): (() => void) =>
    watchPool(
        (link, endpointId) => ({
            onOpen: () => {
                // A daemon from before the strip does not know the request, and has no agent on a device to show.
                link.request('device.operations', {})
                    .then((result) => useDeviceOperated.getState().setAll(endpointId, result.devices))
                    .catch(() => undefined);
            },
            subscriptions: [
                link.on('device.operated', (payload) => useDeviceOperated.getState().receive(endpointId, payload)),
                () => useDeviceOperated.getState().forget(endpointId)
            ]
        }),
        source
    );
