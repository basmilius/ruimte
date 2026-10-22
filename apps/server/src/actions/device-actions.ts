import type { ActionHandlers } from '@ruimte/actions';
import {
    canvasContextSources,
    deriveProjectContextSources,
    deviceButtons,
    isCanvasView,
    type ContextSource,
    type DeviceInfo,
    type DeviceReference,
    type ProjectCanvasView
} from '@ruimte/contracts';
import { arrangedCanvas, isChatView, notOnView, viewRequired } from '../canvas/chat-view.ts';
import { checkDevicePath } from '../canvas/project-paths.ts';
import { refuseOtherMachine } from '../canvas/remote-node.ts';
import type { DeviceActionBody } from '../devices/agent-driver.ts';
import { VerbRefusal, field, orNote, type CanvasHost, type DeviceDriveHost } from '../canvas/verb.ts';
import { CodedError } from '@adecore/agents';
import type { ServerActionContext } from './context.ts';

/* Every device node this caller may operate, for a refusal that offers what the next call takes. */
function deviceLines(sources: readonly ContextSource[], empty: string): string[] {
    return orNote(
        sources
            .filter((source) => source.kind === 'device')
            .map((source) => `device\t${source.id}\t${field(source.title)}\t${field(source.device?.name ?? '')}`),
        empty
    );
}

/* What to say when the caller may operate no device node at all, by where it stands. */
function noDeviceNote(callerCanvas: string | null, chatView: boolean, arranged: ProjectCanvasView | null): string {
    if (arranged !== null) {
        return `${arranged.id} has no device node; ruimte-context node new device --device <id> --view ${arranged.id} puts one there`;
    }
    if (chatView) {
        return 'A chat view operates the device nodes of a canvas it names with --view; ruimte-context node list --view <id> lists them';
    }
    return callerCanvas === null
        ? 'No device node is linked to you, and none can be: you are a view of your own, and a line only runs between two nodes of one canvas'
        : 'No device node is linked to you; ruimte-context link new --to <id> draws the line to one on your canvas';
}

/* What gets a caller a device it may operate: a line, which only runs between two nodes of one canvas. */
function lineLines(id: string, callerCanvas: string | null, deviceCanvas: string): string[] {
    if (callerCanvas === null) {
        return [`note\t${id} stands on ${deviceCanvas}, and you are a view of your own: a line only runs between two nodes of one canvas`];
    }
    if (callerCanvas === deviceCanvas) {
        return [`see\truimte-context link new --to ${id}\tdraws it`];
    }
    return [`note\t${id} stands on ${deviceCanvas} and you on ${callerCanvas}, and a line only runs between two nodes of one canvas`];
}

/*
 * The device a call works on: the one a device node of this project points at, with a line between
 * that node and the caller, the same line a read takes, or on the canvas a chat view names. No card
 * asks a person: the device is a sandbox of its own, and the line is the permission.
 */
async function referenceOf({ host, place }: ServerActionContext, caller: string, id: string, viewId: string | null | undefined): Promise<DeviceReference> {
    const content = await host.projects.read(place.projectId);
    // A peer drives no device: a hidden canvas holds the nodes of another machine, whatever lines it mirrored.
    const callerCanvas = content.views.filter(isCanvasView).find((view) => view.nodes.some((candidate) => candidate.id === caller));
    if (callerCanvas?.hidden === true || host.untrusted?.fromPeer(caller) === true) {
        throw new VerbRefusal('peer-no-device', 'Work another machine gave this one drives no device here');
    }
    const chatView = isChatView(content, caller);
    const arranged = arrangedCanvas(content, caller, viewId);
    const sources = arranged === null ? (deriveProjectContextSources(content.views, null).get(caller) ?? []) : canvasContextSources(arranged);
    const lines = (): string[] => deviceLines(sources, noDeviceNote(place.canvasId, chatView, arranged));
    const canvas = content.views.filter(isCanvasView).find((view) => view.nodes.some((candidate) => candidate.id === id));
    const node = canvas?.nodes.find((candidate) => candidate.id === id);
    if (!canvas || !node) {
        throw new VerbRefusal('unknown-node', `${id} is not a node of this project`, lines());
    }
    refuseOtherMachine(host, id);
    if (arranged !== null && arranged.id !== canvas.id) {
        throw notOnView(id, canvas, arranged, `device state ${id}`);
    }
    if (node.kind !== 'device') {
        throw new VerbRefusal('not-a-device', `${id} is a ${node.kind} node, and only a device node has a device to operate`, lines());
    }
    // A node without a device is no source a line hands over, so this comes before the line.
    if (!node.device) {
        throw new VerbRefusal('no-device', `${id} points at no device yet; a person picks one on the node`);
    }
    if (!sources.some((source) => source.id === id)) {
        if (chatView) {
            throw viewRequired(id, canvas, `device state ${id}`);
        }
        throw new VerbRefusal('not-linked', `No line runs between you and ${id}, and that line is what lets you operate its device`, [
            ...lineLines(id, place.canvasId, canvas.id),
            ...lines()
        ]);
    }
    return node.device;
}

function driverOf(host: CanvasHost): DeviceDriveHost {
    if (!host.devices) {
        throw new VerbRefusal('unavailable', 'This machine has no devices to operate');
    }
    return host.devices;
}

/* The device a node points at on this machine now, refused when it is not here or not running. */
async function bootedDevice(context: ServerActionContext, caller: string, nodeId: string, viewId: string | null | undefined): Promise<DeviceInfo> {
    const reference = await referenceOf(context, caller, nodeId, viewId);
    const device = await driverOf(context.host).find(reference);
    if (device === null) {
        throw new VerbRefusal('device-missing', `This machine has no ${reference.name} (${reference.runtime}) right now`, [
            'note\tA phone that is unplugged or a simulator that was removed is not there to be found; the person brings it back'
        ]);
    }
    if (device.state !== 'booted') {
        throw new VerbRefusal(
            'device-not-booted',
            `${device.name} is not running${device.state === 'transitioning' ? ' yet: it is starting or stopping' : ''}`,
            ['note\tAn agent never starts a device: ask the person to start it from its node, then call again']
        );
    }
    return device;
}

/* One device of this machine as device list prints it, by the id node new device takes. */
export function machineDeviceLine(device: Pick<DeviceInfo, 'deviceId' | 'name' | 'platform' | 'kind' | 'runtime' | 'state'>): string {
    return `device\t${device.deviceId}\t${field(device.name)}\t${device.platform}\t${device.kind}\t${field(device.runtime)}\t${device.state}`;
}

/* The device a new device node shows, by the id device list gives it, as the node keeps it. */
export async function machineDevice(host: CanvasHost, deviceId: string): Promise<DeviceReference> {
    const devices = await driverOf(host).list();
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) {
        throw new VerbRefusal(
            'unknown-device',
            `${deviceId} is not a device of this machine right now`,
            orNote(devices.map(machineDeviceLine), 'This machine has no simulator, emulator or phone right now; the person brings one')
        );
    }
    return { platform: device.platform, kind: device.kind, name: device.name, runtime: device.runtime };
}

/* A path an agent hands a device, held to the folder rule of --cwd: the project folder or one of its worktrees. */
function devicePath({ host, place }: ServerActionContext, path: string): Promise<string> {
    return checkDevicePath(place.folder, path, (folder) => host.checkouts.paths(folder));
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
    if (input.battery !== null && input.battery !== undefined) {
        bodies.push({ action: 'setBattery', level: input.battery, charging: input.charging ?? false });
    } else if (input.charging !== null && input.charging !== undefined) {
        throw new VerbRefusal('bad-arguments', '--charging goes with --battery N, the level it charges at');
    }
    const located = input.latitude !== null && input.latitude !== undefined && input.longitude !== null && input.longitude !== undefined;
    if (located && input.clearLocation) {
        throw new VerbRefusal('bad-arguments', 'A device takes --location or --clear-location, not both');
    }
    if (located) {
        bodies.push({ action: 'setLocation', latitude: input.latitude!, longitude: input.longitude! });
    } else if (input.clearLocation) {
        bodies.push({ action: 'clearLocation' });
    }
    if (bodies.length === 0) {
        throw new VerbRefusal('bad-arguments', 'device set needs something to change', [
            'note\t--appearance, --text-size, --status-bar, --battery with --charging, --location or --clear-location'
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
    'device.inspect': async ({ nodeId, viewId, find }, { actor, context }) => {
        const reference = await referenceOf(context, actor.id, nodeId, viewId);
        const driver = driverOf(context.host);
        const device = await driver.find(reference);
        if (device === null) {
            return {
                output: {
                    nodeId,
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
    'device.screenshot': async ({ nodeId, viewId }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        const shot = await driverOf(context.host).shot(actor.id, device, nodeId);
        return { output: { nodeId, ...shot } };
    },
    'device.tap': async ({ nodeId, viewId, x, y, element }, { actor, context }) => {
        const handle = element ?? null;
        const pixel = x === null || x === undefined || y === null || y === undefined ? null : { x, y };
        if (handle === null ? pixel === null : (x ?? y ?? null) !== null) {
            throw new VerbRefusal('bad-arguments', 'A tap takes either an element of the last state or a pixel of the last shot as x and y', [
                'see\truimte-context device state <id>\tnumbers the elements',
                'see\truimte-context device shot <id>\ttakes a picture to count pixels in'
            ]);
        }
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        const driver = driverOf(context.host);
        if (handle !== null) {
            await driver.tapElement(actor.id, device, handle);
        } else if (pixel !== null) {
            await driver.tap(actor.id, device, pixel);
        }
        return { output: { nodeId, device: device.name } };
    },
    'device.swipe': async ({ nodeId, viewId, fromX, fromY, toX, toY, ms }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        await driverOf(context.host).swipe(actor.id, device, { x: fromX, y: fromY }, { x: toX, y: toY }, ms ?? undefined);
        return { output: { nodeId, device: device.name } };
    },
    'device.button': async ({ nodeId, viewId, button }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        const buttons = deviceButtons(device);
        const named = buttons.find((candidate) => candidate === button);
        if (named === undefined) {
            throw new VerbRefusal(
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
    'device.type': async ({ nodeId, viewId, text }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        await driverOf(context.host).type(actor.id, device, text);
        return { output: { nodeId, device: device.name } };
    },
    'device.set': async (input, { actor, context }) => {
        const bodies = setBodies(input);
        const device = await bootedDevice(context, actor.id, input.nodeId, input.viewId);
        await driverOf(context.host).act(actor.id, device, 'set', bodies);
        return { output: { nodeId: input.nodeId, device: device.name } };
    },
    'device.open': async ({ nodeId, viewId, url }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        await driverOf(context.host).act(actor.id, device, 'open', [{ action: 'openUrl', url }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.permission': async ({ nodeId, viewId, app, decision, permission }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        await driverOf(context.host).act(actor.id, device, 'permission', [
            permission ? { action: 'setPermission', appId: app, permission, decision } : { action: 'setAllPermissions', appId: app, decision }
        ]);
        return { output: { nodeId, device: device.name } };
    },
    'device.push': async ({ nodeId, viewId, app, payload }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        await driverOf(context.host).act(actor.id, device, 'push', [{ action: 'sendPush', appId: app, payload }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.biometric': async ({ nodeId, viewId, event, sensor }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        await driverOf(context.host).act(actor.id, device, 'biometric', [
            { action: 'biometric', event, sensor: sensor ?? (device.platform === 'ios' ? 'face' : 'finger') }
        ]);
        return { output: { nodeId, device: device.name } };
    },
    'device.clipboard': async ({ nodeId, viewId, text }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        const held = await driverOf(context.host).clipboard(actor.id, device, text ?? null);
        return { output: { nodeId, device: device.name, text: held } };
    },
    'device.record': async ({ nodeId, viewId, seconds }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        const path = await driverOf(context.host).record(actor.id, device, seconds, nodeId);
        return { output: { nodeId, device: device.name, path } };
    },
    'device.install': async ({ nodeId, viewId, path }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        const checked = await devicePath(context, path);
        await driverOf(context.host).act(actor.id, device, 'install', [{ action: 'installApp', path: checked }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.media': async ({ nodeId, viewId, paths }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        const checked = await Promise.all(paths.map((path) => devicePath(context, path)));
        await driverOf(context.host).act(actor.id, device, 'media', [{ action: 'addMedia', paths: checked }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.terminate': async ({ nodeId, viewId, app }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        await driverOf(context.host).act(actor.id, device, 'terminate', [{ action: 'terminateApp', appId: app }]);
        return { output: { nodeId, device: device.name } };
    },
    'device.launch': async ({ nodeId, viewId, app }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId, viewId);
        const driver = driverOf(context.host);
        if (!driver.abilities(device).launch) {
            throw new VerbRefusal('device-action-unavailable', `Ruimte cannot open an app on ${device.name}`);
        }
        await driver.launch(actor.id, device, app);
        return { output: { nodeId, device: device.name } };
    }
};
