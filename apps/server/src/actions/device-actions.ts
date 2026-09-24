import type { ActionHandlers } from '@ruimte/actions';
import { deriveProjectContextSources, deviceButtons, isCanvasView, type ContextSource, type DeviceInfo, type DeviceReference } from '@ruimte/contracts';
import { VerbRefusal, field, orNote, type CanvasHost, type DeviceDriveHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

/* Every device node this caller may operate, for a refusal that offers what the next call takes. */
const deviceLines = (sources: readonly ContextSource[], callerCanvas: string | null): string[] =>
    orNote(
        sources
            .filter((source) => source.kind === 'device')
            .map((source) => `device\t${source.id}\t${field(source.title)}\t${field(source.device?.name ?? '')}`),
        callerCanvas === null
            ? 'No device node is linked to you, and none can be: you are a view of your own, and a line only runs between two nodes of one canvas'
            : 'No device node is linked to you; ruimte-context link new --to <id> draws the line to one on your canvas'
    );

/* What gets a caller a device it may operate: a line, which only runs between two nodes of one canvas. */
const lineLines = (id: string, callerCanvas: string | null, deviceCanvas: string): string[] => {
    if (callerCanvas === null) {
        return [`note\t${id} stands on ${deviceCanvas}, and you are a view of your own: a line only runs between two nodes of one canvas`];
    }
    if (callerCanvas === deviceCanvas) {
        return [`see\truimte-context link new --to ${id}\tdraws it`];
    }
    return [`note\t${id} stands on ${deviceCanvas} and you on ${callerCanvas}, and a line only runs between two nodes of one canvas`];
};

/*
 * The device a call works on: the one a device node of this project points at, with a line between
 * that node and the caller, the same line a read takes. No card asks a person: the device is a
 * sandbox of its own, and the line is the permission.
 */
const referenceOf = async ({ host, place }: ServerActionContext, caller: string, id: string): Promise<DeviceReference> => {
    const content = await host.read(place.projectId);
    const sources = deriveProjectContextSources(content.views, null).get(caller) ?? [];
    const canvas = content.views.filter(isCanvasView).find((view) => view.nodes.some((candidate) => candidate.id === id));
    const node = canvas?.nodes.find((candidate) => candidate.id === id);
    if (!canvas || !node) {
        throw new VerbRefusal('unknown-node', `${id} is not a node of this project`, deviceLines(sources, place.canvasId));
    }
    if (node.kind !== 'device') {
        throw new VerbRefusal(
            'not-a-device',
            `${id} is a ${node.kind} node, and only a device node has a device to operate`,
            deviceLines(sources, place.canvasId)
        );
    }
    // A node without a device is no source a line hands over, so this comes before the line.
    if (!node.device) {
        throw new VerbRefusal('no-device', `${id} points at no device yet; a person picks one on the node`);
    }
    if (!sources.some((source) => source.id === id)) {
        throw new VerbRefusal('not-linked', `No line runs between you and ${id}, and that line is what lets you operate its device`, [
            ...lineLines(id, place.canvasId, canvas.id),
            ...deviceLines(sources, place.canvasId)
        ]);
    }
    return node.device;
};

const driverOf = (host: CanvasHost): DeviceDriveHost => {
    if (!host.devices) {
        throw new VerbRefusal('unavailable', 'This machine has no devices to operate');
    }
    return host.devices;
};

/* The device a node points at on this machine now, refused when it is not here or not running. */
const bootedDevice = async (context: ServerActionContext, caller: string, nodeId: string): Promise<DeviceInfo> => {
    const reference = await referenceOf(context, caller, nodeId);
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
};

export const deviceActions: ActionHandlers<ServerActionContext> = {
    'device.inspect': async ({ nodeId }, { actor, context }) => {
        const reference = await referenceOf(context, actor.id, nodeId);
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
                    can: { shot: false, input: false, type: false, launch: false }
                }
            };
        }
        return {
            output: {
                nodeId,
                device: reference,
                present: true,
                state: device.state,
                screen: driver.screen(device),
                buttons: deviceButtons(device),
                can: driver.abilities(device)
            }
        };
    },
    'device.screenshot': async ({ nodeId }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const shot = await driverOf(context.host).shot(device, nodeId);
        return { output: { nodeId, ...shot } };
    },
    'device.tap': async ({ nodeId, x, y }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).tap(nodeId, actor.id, device, { x, y });
        return { output: { nodeId, device: device.name } };
    },
    'device.swipe': async ({ nodeId, fromX, fromY, toX, toY, ms }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).swipe(nodeId, actor.id, device, { x: fromX, y: fromY }, { x: toX, y: toY }, ms ?? undefined);
        return { output: { nodeId, device: device.name } };
    },
    'device.button': async ({ nodeId, button }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
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
        await driverOf(context.host).button(nodeId, actor.id, device, named);
        return { output: { nodeId, device: device.name } };
    },
    'device.type': async ({ nodeId, text }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        await driverOf(context.host).type(nodeId, actor.id, device, text);
        return { output: { nodeId, device: device.name } };
    },
    'device.launch': async ({ nodeId, app }, { actor, context }) => {
        const device = await bootedDevice(context, actor.id, nodeId);
        const driver = driverOf(context.host);
        if (!driver.abilities(device).launch) {
            throw new VerbRefusal('device-action-unavailable', `Ruimte cannot open an app on ${device.name}`);
        }
        await driver.launch(nodeId, device, app);
        return { output: { nodeId, device: device.name } };
    }
};
