import type { ActionHandlers } from '@ruimte/actions';
import { deviceButtons, isCanvasView, type DeviceInfo, type DeviceReference } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';
import { ToolRefusal } from '@adecore/agents/context';
import { checkDevicePath } from '../tools/project-paths.ts';
import { refuseOtherMachine } from '../tools/remote-node.ts';
import type { DeviceActionBody } from '../devices/agent-driver.ts';
import { field, orNote, type CanvasHost, type DeviceDriveHost } from '../tools/host.ts';
import type { ServerActionContext } from './context.ts';

const NO_DEVICES = 'This machine has no simulator, emulator or phone right now; the person brings one';

/* What an id an agent gave names: the device a node points at, or one of this machine by its id, null when this machine lacks it now. */
interface DeviceTarget {
    reference: DeviceReference;
    device: DeviceInfo | null;
}

function driverOf(host: CanvasHost): DeviceDriveHost {
    if (!host.devices) {
        throw new ToolRefusal('unavailable', 'This machine has no devices to operate');
    }
    return host.devices;
}

/* One device of this machine as device list prints it, by the id every other device action takes. */
export function machineDeviceLine(device: Pick<DeviceInfo, 'deviceId' | 'name' | 'platform' | 'kind' | 'runtime' | 'state'>): string {
    return `device\t${device.deviceId}\t${field(device.name)}\t${device.platform}\t${device.kind}\t${field(device.runtime)}\t${device.state}`;
}

function referenceOf(device: DeviceInfo): DeviceReference {
    return { platform: device.platform, kind: device.kind, name: device.name, runtime: device.runtime };
}

/*
 * The device an agent names, by the id `device_list` gives it or by a device node of its project, with
 * no line or view: the device is a sandbox of its own, and one agent at a time holds it. Work another
 * machine gave drives no device here, and a node bound to another machine is that machine's.
 */
async function targetOf({ host, place }: ServerActionContext, caller: string, id: string): Promise<DeviceTarget> {
    const content = await host.projects.read(place.projectId);
    const canvases = content.views.filter(isCanvasView);
    const callerCanvas = canvases.find((view) => view.nodes.some((candidate) => candidate.id === caller));

    if (callerCanvas?.hidden === true || host.untrusted?.fromPeer(caller) === true) {
        throw new ToolRefusal('peer-no-device', 'Work another machine gave this one drives no device here');
    }

    const driver = driverOf(host);
    const node = canvases.flatMap((view) => view.nodes).find((candidate) => candidate.id === id);

    if (node !== undefined) {
        refuseOtherMachine(host, id);

        if (node.kind !== 'device') {
            throw new ToolRefusal('not-a-device', `${id} is a ${node.kind} node, and only a device node has a device to operate`, [
                'see\tdevice_list\tthe devices of this machine, by the id every device tool takes'
            ]);
        }

        if (!node.device) {
            throw new ToolRefusal('no-device', `${id} points at no device yet; a person picks one on the node`);
        }

        return { reference: node.device, device: await driver.find(node.device) };
    }

    const devices = await driver.list();
    const device = devices.find((candidate) => candidate.deviceId === id);

    if (!device) {
        throw new ToolRefusal('unknown-device', `${id} is not a device of this machine right now`, orNote(devices.map(machineDeviceLine), NO_DEVICES));
    }

    return { reference: referenceOf(device), device };
}

/* An agent's call takes the device for it; an extension a person installed holds no claim. */
function claim({ host, extension }: ServerActionContext, caller: string, device: DeviceInfo): void {
    if (extension !== true) {
        driverOf(host).claim(caller, device);
    }
}

function missing(reference: DeviceReference): ToolRefusal {
    return new ToolRefusal('device-missing', `This machine has no ${reference.name} (${reference.runtime}) right now`, [
        'note\tA phone that is unplugged or a simulator that was removed is not there to be found; the person brings it back'
    ]);
}

/* The device an id names on this machine now, claimed for the caller, refused when it is not here or not running. */
async function bootedDevice(context: ServerActionContext, caller: string, id: string): Promise<DeviceInfo> {
    const { reference, device } = await targetOf(context, caller, id);

    if (device === null) {
        throw missing(reference);
    }

    if (device.state !== 'booted') {
        throw new ToolRefusal(
            'device-not-booted',
            `${device.name} is not running${device.state === 'transitioning' ? ' yet: it is starting or stopping' : ''}`,
            [
                device.kind === 'physical'
                    ? 'note\tRuimte starts no phone: ask the person to turn it on and unlock it, then call again'
                    : 'see\tdevice_start\tstarts it, then call again'
            ]
        );
    }

    claim(context, caller, device);

    return device;
}

/* The device a new device node shows, by the id device list gives it, as the node keeps it. */
export async function machineDevice(host: CanvasHost, deviceId: string): Promise<DeviceReference> {
    const devices = await driverOf(host).list();
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) {
        throw new ToolRefusal('unknown-device', `${deviceId} is not a device of this machine right now`, orNote(devices.map(machineDeviceLine), NO_DEVICES));
    }
    return referenceOf(device);
}

/* A path an agent hands a device: inside the project folder, one of its worktrees, the caller's own chat folders or the system's temporary ones. */
function devicePath({ host, place }: ServerActionContext, caller: string, path: string): Promise<string> {
    return checkDevicePath(place.folder, path, (folder) => host.checkouts.paths(folder), driverOf(host).pathFolders(caller));
}

/* What device set asks for, one action per thing it changes, in the order a person would set them. */
function setBodies(input: {
    appearance?: 'light' | 'dark' | null;
    textSize?: 'small' | 'default' | 'large' | 'extra-large' | null;
    statusBar?: 'clean' | 'default' | null;
    battery?: number | null;
    charging?: boolean | null;
    latitude?: number | null;
    longitude?: number | null;
    clearLocation?: boolean | null;
}): DeviceActionBody[] {
    const bodies: DeviceActionBody[] = [];
    if (input.appearance) {
        bodies.push({ action: 'setAppearance', value: input.appearance });
    }
    if (input.textSize) {
        bodies.push({ action: 'setTextSize', value: input.textSize });
    }
    if (input.statusBar) {
        bodies.push({ action: 'setStatusBar', value: input.statusBar });
    }
    if (input.battery != null) {
        bodies.push({ action: 'setBattery', level: input.battery, charging: input.charging ?? false });
    } else if (input.charging != null) {
        throw new ToolRefusal('bad-arguments', 'charging goes with battery, the level it charges at');
    }
    const { latitude, longitude } = input;
    const located = latitude != null && longitude != null;
    if (located && input.clearLocation) {
        throw new ToolRefusal('bad-arguments', 'A device takes location or clear_location, not both');
    }
    if (located) {
        bodies.push({ action: 'setLocation', latitude, longitude });
    } else if (input.clearLocation) {
        bodies.push({ action: 'clearLocation' });
    }
    if (bodies.length === 0) {
        throw new ToolRefusal('bad-arguments', 'device_set needs something to change', [
            'note\tappearance, text_size, status_bar, battery with charging, location or clear_location'
        ]);
    }
    return bodies;
}

export const deviceActions: ActionHandlers<ServerActionContext> = {
    'device.list': async (_input, { context }) => {
        const devices = await driverOf(context.host).list();
        return {
            output: {
                devices: devices.map(({ deviceId, platform, kind, name, runtime, state }) => ({ deviceId, platform, kind, name, runtime, state }))
            }
        };
    },
    'device.start': async ({ nodeId: id }, { actor, context }) => {
        const { reference, device } = await targetOf(context, actor.id, id);

        if (device === null) {
            throw missing(reference);
        }

        if (device.kind === 'physical') {
            throw new ToolRefusal('device-not-startable', `${device.name} is a phone, and Ruimte starts only a simulator or an emulator`, [
                'note\tAsk the person to turn it on and unlock it, then call again'
            ]);
        }

        if (!device.capabilities.boot) {
            throw new ToolRefusal('device-not-startable', `Ruimte cannot start ${device.name} on this machine`);
        }

        claim(context, actor.id, device);
        const started = await driverOf(context.host).start(device);

        return { output: { nodeId: id, device: started.device.name, state: started.device.state, ready: started.ready } };
    },
    'device.inspect': async ({ nodeId, find }, { actor, context }) => {
        const { reference, device } = await targetOf(context, actor.id, nodeId);
        const driver = driverOf(context.host);
        if (device === null) {
            return {
                output: {
                    nodeId,
                    deviceId: null,
                    device: reference,
                    present: false,
                    state: null,
                    screen: null,
                    buttons: [],
                    can: { shot: false, input: false, type: false, launch: false, tree: false },
                    power: null,
                    tree: null,
                    treeError: null
                }
            };
        }
        claim(context, actor.id, device);
        const can = driver.abilities(device);
        let tree: Awaited<ReturnType<DeviceDriveHost['tree']>> | null = null;
        let treeError: string | null = null;
        if (can.tree) {
            try {
                tree = await driver.tree(actor.id, device, find ?? null);
            } catch (error) {
                // The rest of the state still holds, so a tree that would not come is said, not refused.
                if (!(error instanceof CodedError)) {
                    throw error;
                }
                treeError = error.message;
            }
        }
        return {
            output: {
                nodeId,
                deviceId: device.deviceId,
                device: reference,
                present: true,
                state: device.state,
                screen: driver.screen(device),
                buttons: deviceButtons(device),
                can,
                power: await driver.power(device),
                tree:
                    tree === null
                        ? null
                        : {
                              ...tree,
                              elements: tree.elements.map(({ parent: _parent, ...element }) => element)
                          },
                treeError
            }
        };
    },
    'device.screenshot': async ({ nodeId }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const shot = await driverOf(context.host).shot(actor.id, device, nodeId);
        return { output: { nodeId, ...shot } };
    },
    'device.tap': async ({ nodeId, x, y, element }, { actor, context }) => {
        const handle = element ?? null;
        const pixel = x == null || y == null ? null : { x, y };
        if (handle === null ? pixel === null : (x ?? y ?? null) !== null) {
            throw new ToolRefusal('bad-arguments', 'A tap takes either an element of the last state or a pixel of the last shot as x and y', [
                'see\tdevice_state\tnumbers the elements',
                'see\tdevice_shot\ttakes a picture to count pixels in'
            ]);
        }
        const device = await bootedDevice(context, actor.id, nodeId);
        const driver = driverOf(context.host);
        if (handle !== null) {
            await driver.tapElement(actor.id, device, handle);
        } else if (pixel !== null) {
            await driver.tap(actor.id, device, pixel);
        }
        return { output: { nodeId, device: device.name } };
    },
    'device.swipe': async ({ nodeId, fromX, fromY, toX, toY, ms }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).swipe(actor.id, device, { x: fromX, y: fromY }, { x: toX, y: toY }, ms ?? undefined);
        return { output: { nodeId, device: device.name } };
    },
    'device.button': async ({ nodeId, button }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const buttons = deviceButtons(device);
        const named = buttons.find((candidate) => candidate === button);
        if (named === undefined) {
            throw new ToolRefusal(
                'unknown-button',
                `${device.name} has no ${button} button`,
                orNote(
                    buttons.map((candidate) => `button\t${candidate}`),
                    `${device.name} announces no buttons`
                )
            );
        }
        await driverOf(context.host).button(actor.id, device, named);
        return { output: { nodeId, device: device.name } };
    },
    'device.type': async ({ nodeId, text }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).type(actor.id, device, text);
        return { output: { nodeId, device: device.name } };
    },
    'device.set': async (input, { actor, context }) => {
        const bodies = setBodies(input);
        const device = await bootedDevice(context, actor.id, input.nodeId);
        await driverOf(context.host).act(actor.id, device, 'set', bodies);
        return { output: { nodeId: input.nodeId, device: device.name } };
    },
    'device.open': async ({ nodeId, url }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).act(actor.id, device, 'open', [{ action: 'openUrl', url }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.permission': async ({ nodeId, app, decision, permission }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).act(actor.id, device, 'permission', [
            permission ? { action: 'setPermission', appId: app, permission, decision } : { action: 'setAllPermissions', appId: app, decision }
        ]);
        return { output: { nodeId, device: device.name } };
    },
    'device.push': async ({ nodeId, app, payload }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).act(actor.id, device, 'push', [{ action: 'sendPush', appId: app, payload }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.biometric': async ({ nodeId, event, sensor }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).act(actor.id, device, 'biometric', [
            { action: 'biometric', event, sensor: sensor ?? (device.platform === 'ios' ? 'face' : 'finger') }
        ]);
        return { output: { nodeId, device: device.name } };
    },
    'device.clipboard': async ({ nodeId, text }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const held = await driverOf(context.host).clipboard(actor.id, device, text ?? null);
        return { output: { nodeId, device: device.name, text: held } };
    },
    'device.record': async ({ nodeId, seconds }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const path = await driverOf(context.host).record(actor.id, device, seconds, nodeId);
        return { output: { nodeId, device: device.name, path } };
    },
    'device.install': async ({ nodeId, path }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const checked = await devicePath(context, actor.id, path);
        await driverOf(context.host).act(actor.id, device, 'install', [{ action: 'installApp', path: checked }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.media': async ({ nodeId, paths }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const checked = await Promise.all(paths.map((path) => devicePath(context, actor.id, path)));
        await driverOf(context.host).act(actor.id, device, 'media', [{ action: 'addMedia', paths: checked }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.terminate': async ({ nodeId, app }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).act(actor.id, device, 'terminate', [{ action: 'terminateApp', appId: app }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.launch': async ({ nodeId, app }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const driver = driverOf(context.host);
        if (!driver.abilities(device).launch) {
            throw new ToolRefusal('device-action-unavailable', `Ruimte cannot open an app on ${device.name}`);
        }
        await driver.launch(actor.id, device, app);
        return { output: { nodeId, device: device.name } };
    }
};
