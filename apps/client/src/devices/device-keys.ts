import { hidUsageOf } from '@/devices/hid-usages';

type DeviceKeyRoute =
    | { kind: 'key'; usage: number }
    /* The paste chord, which pastes the person's own clipboard so accents and emoji arrive too. */
    | { kind: 'paste' }
    /* A key the device has no use for, or one it repeats by itself; kept from the page. */
    | { kind: 'swallow' }
    /* A chord of Ruimte's, which stays with its shortcuts. */
    | { kind: 'pass' };

export interface KeyPress {
    code: string;
    metaKey: boolean;
    ctrlKey: boolean;
    repeat: boolean;
    isComposing: boolean;
}

/*
 * Where a key down goes. Every chord with the command key of this keyboard (⌘ on a Mac, Ctrl elsewhere)
 * stays Ruimte's, so its shortcuts keep working with the focus on a device, except paste.
 */
export function routeDeviceKey(press: KeyPress, apple: boolean): DeviceKeyRoute {
    const command = apple ? press.metaKey : press.ctrlKey;
    const commandKey = apple ? press.code === 'MetaLeft' || press.code === 'MetaRight' : press.code === 'ControlLeft' || press.code === 'ControlRight';
    if (command || commandKey) {
        return press.code === 'KeyV' && !press.repeat ? { kind: 'paste' } : { kind: 'pass' };
    }
    if (press.isComposing || press.repeat) {
        return { kind: 'swallow' };
    }
    const usage = hidUsageOf(press.code);
    return usage === null ? { kind: 'pass' } : { kind: 'key', usage };
}
