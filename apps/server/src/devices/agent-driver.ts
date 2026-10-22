import {
    deviceTools,
    type DeviceAction,
    type DeviceButton,
    type DeviceInfo,
    type DeviceInput,
    type DevicePower,
    type DeviceReference,
    type DeviceTool
} from '@ruimte/contracts';
import { realTimers, type Timers } from '../computer/approvals.ts';
import { CodedError } from '@adecore/agents';
import { captureFile, pngSize, writeShot } from '../shots.ts';
import { centerOf, findElements, flattenTree, type DeviceElement } from './device-tree.ts';
import type { DeviceManager } from './manager.ts';

/* How long an agent's session on a device outlives its last call, so a run of taps shares one and a finished agent leaves none behind. */
export const AGENT_HOLD_IDLE_MS = 60_000;

/* How long a finger rests on the glass for a tap: long enough for a button to see it, short of a long press. */
const TAP_MS = 60;

/* One move per frame of a 60 Hz screen, so a scroll view reads the speed a person's finger has. */
const SWIPE_STEP_MS = 16;

export const SWIPE_DEFAULT_MS = 300;

export interface Pixel {
    x: number;
    y: number;
}

export interface DeviceShot {
    path: string;
    width: number;
    height: number;
}

/* What an agent can do on a device, read off what it announces; a device that is not booted can do none of it. */
export interface DeviceAbilities {
    shot: boolean;
    input: boolean;
    type: boolean;
    launch: boolean;
    tree: boolean;
}

/* A state's tree as an agent reads it; `elements` is every element, or with a text only the ones that hold it and what they sit in. */
export interface DeviceTreeRead {
    screen: { width: number; height: number };
    truncated: boolean;
    count: number;
    matches: number | null;
    elements: DeviceElement[];
}

/* One step of an agent on a device; a tap in the share of the screen from its top-left corner. */
export type AgentStep =
    | { kind: 'tap'; x: number; y: number }
    | { kind: 'swipe' }
    | { kind: 'type' }
    | { kind: 'button'; button: DeviceButton }
    | { kind: 'launch'; app: string }
    | { kind: 'shot' }
    | { kind: ToolStepKind };

/* The steps of the tools beside shots and taps, each named after its verb. */
export type ToolStepKind = 'set' | 'open' | 'permission' | 'push' | 'biometric' | 'clipboard' | 'record' | 'install' | 'media' | 'terminate';

/* An action of a device without the device it acts on, which the driver adds. */
export type DeviceActionBody = DeviceAction extends infer Action
    ? Action extends DeviceAction
        ? Omit<Action, 'backendId' | 'platform' | 'deviceId'>
        : never
    : never;

/* The tool a device has to announce before an agent may use an action on it. */
const ACTION_TOOLS: Partial<Record<DeviceAction['action'], DeviceTool>> = {
    setAppearance: 'appearance',
    setTextSize: 'textSize',
    setStatusBar: 'statusBar',
    setBattery: 'battery',
    resetBattery: 'battery',
    setLocation: 'location',
    clearLocation: 'clearLocation',
    openUrl: 'openUrl',
    setPermission: 'permissions',
    setAllPermissions: 'permissions',
    sendPush: 'push',
    biometric: 'biometrics',
    installApp: 'installApp',
    addMedia: 'addMedia',
    terminateApp: 'terminateApp'
};

/* What a recording an agent asks for may last, so a forgotten one cannot hold the device for long. */
export const AGENT_RECORDING_MAX_SECONDS = 60;

/*
 * Whether a person lets an agent take a step on a device right now. The one place a pause or a
 * take-over from the node answers, so every step passes it before it touches the device; a shot
 * passes it as well, so the person sees it, and is left to the gate to let through.
 */
export interface DeviceGate {
    admit(device: DeviceInfo, caller: string, step: AgentStep): { code: string; message: string } | null;
    /* Asked between the moves of a step under way: refuses as `admit` does while the person holds the device, without counting as a step. */
    recheck(device: DeviceInfo): { code: string; message: string } | null;
}

export const OPEN_GATE: DeviceGate = { admit: () => null, recheck: () => null };

type Manager = Pick<
    DeviceManager,
    | 'list'
    | 'find'
    | 'hold'
    | 'release'
    | 'input'
    | 'keys'
    | 'paste'
    | 'canType'
    | 'type'
    | 'screenshot'
    | 'action'
    | 'canTree'
    | 'tree'
    | 'closeTree'
    | 'clipboard'
    | 'startRecording'
    | 'stopRecording'
    | 'power'
>;

export interface DeviceDriverOptions {
    home: string;
    manager: Manager;
    timers?: Timers;
    sleep?: (ms: number) => Promise<void>;
    gate?: DeviceGate;
}

interface Hold {
    device: DeviceInfo;
    holder: string;
    cancel: () => void;
}

/*
 * An agent reading a device's elements: the reader behind it keeps running while the agent keeps
 * calling, and `known` is the last tree, which the handles of its state point into.
 */
interface Reading {
    device: DeviceInfo;
    known: { screen: { width: number; height: number }; elements: DeviceElement[] } | null;
    cancel: () => void;
}

function deviceKey(device: Pick<DeviceInfo, 'backendId' | 'deviceId'>): string {
    return `${device.backendId}\u0000${device.deviceId}`;
}

/*
 * The door an agent operates a device through. It holds a session of its own for as long as the
 * agent keeps calling, so a tap lands whether or not a client shows the node, and it counts every
 * coordinate in pixels of the last shot, which is the picture the agent decided on.
 */
export class DeviceDriver {
    private readonly home: string;
    private readonly manager: Manager;
    private readonly timers: Timers;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly gate: DeviceGate;
    private readonly shots = new Map<string, { width: number; height: number }>();
    private readonly holds = new Map<string, Hold>();
    private readonly readings = new Map<string, Reading>();

    constructor(options: DeviceDriverOptions) {
        this.home = options.home;
        this.manager = options.manager;
        this.timers = options.timers ?? realTimers;
        this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
        this.gate = options.gate ?? OPEN_GATE;
    }

    list(): Promise<DeviceInfo[]> {
        return this.manager.list();
    }

    find(reference: DeviceReference): Promise<DeviceInfo | null> {
        return this.manager.find(reference);
    }

    /* Read only, for an agent that tests what an app does on a low battery; only a phone has one of its own. */
    power(device: DeviceInfo): Promise<DevicePower | null> {
        return device.kind === 'physical' ? this.manager.power(device.backendId, device.platform, device.deviceId) : Promise.resolve(null);
    }

    /* The size of the last shot of this device, which is what coordinates are counted in; null before one. */
    screen(device: DeviceInfo): { width: number; height: number } | null {
        return this.shots.get(deviceKey(device)) ?? null;
    }

    abilities(device: DeviceInfo): DeviceAbilities {
        const booted = device.state === 'booted';
        return {
            shot: booted && device.capabilities.screenshot,
            input: booted && device.capabilities.input,
            type: booted && this.manager.canType(device),
            launch: booted && deviceTools(device).includes('launchApp'),
            tree: booted && this.manager.canTree(device)
        };
    }

    /*
     * Reads what the device shows as elements, which counts as looking, like a shot. The handles it
     * gives out hold until the next read of this device, and the reader behind it keeps running as
     * long as the agent keeps calling.
     */
    async tree(caller: string, device: DeviceInfo, find: string | null = null): Promise<DeviceTreeRead> {
        if (!this.manager.canTree(device)) {
            throw new CodedError('device-tree-unavailable', `Ruimte cannot read the elements on ${device.name}; a shot shows what it has on screen`);
        }
        this.pass(caller, device, { kind: 'shot' });
        const key = deviceKey(device);
        const reading = this.readings.get(key) ?? { device, known: null, cancel: () => undefined };
        reading.known = null;
        this.keepReading(key, reading);
        const tree = await this.manager.tree(device.backendId, device.platform, device.deviceId);
        const elements = flattenTree(tree);
        reading.known = { screen: tree.screen, elements };
        const found = find === null ? null : findElements(elements, find);
        return {
            screen: tree.screen,
            truncated: tree.truncated,
            count: elements.length,
            matches: found?.matches ?? null,
            elements: found?.elements ?? elements
        };
    }

    /* `id` is the device node's, which names the file. */
    async shot(caller: string, device: DeviceInfo, id: string): Promise<DeviceShot> {
        this.pass(caller, device, { kind: 'shot' });
        const image = await this.manager.screenshot(device.backendId, device.platform, device.deviceId);
        const size = pngSize(image);
        if (size === null) {
            throw new CodedError('device-capture-failed', 'The device answered with something that is not a png');
        }
        const path = await writeShot(this.home, id, image);
        this.shots.set(deviceKey(device), size);
        return { path, ...size };
    }

    async tap(caller: string, device: DeviceInfo, at: Pixel): Promise<void> {
        await this.press(caller, device, this.normalized(device, at));
    }

    /* Taps the middle of an element of the last state, which needs no shot: the tree knows its own screen. */
    async tapElement(caller: string, device: DeviceInfo, handle: number): Promise<void> {
        const known = this.readings.get(deviceKey(device))?.known;
        if (!known) {
            throw new CodedError(
                'stale-element',
                `There is no state of ${device.name} for element ${handle} to come from: its elements last until the next state, and an agent that stopped calling for a minute has none`,
                ['see\truimte-context device state <id>\treads the elements again']
            );
        }
        const element = known.elements[handle];
        if (!element) {
            throw new CodedError('unknown-element', `The last state of ${device.name} has no element ${handle}; it has 0 to ${known.elements.length - 1}`, [
                'see\truimte-context device state <id>\treads the elements again'
            ]);
        }
        const center = centerOf(element);
        if (center.x < 0 || center.y < 0 || center.x >= known.screen.width || center.y >= known.screen.height) {
            throw new CodedError('offscreen-element', `Element ${handle} of ${device.name} lies off the screen, so a tap cannot reach it`, [
                'note\tScroll it into view with device swipe, then read the state again'
            ]);
        }
        await this.press(caller, device, { x: center.x / known.screen.width, y: center.y / known.screen.height });
    }

    private async press(caller: string, device: DeviceInfo, point: { x: number; y: number }): Promise<void> {
        await this.operate(caller, device, { kind: 'tap', ...point }, async (send) => {
            await send({ kind: 'pointer', phase: 'down', ...point });
            await this.sleep(TAP_MS);
            await send({ kind: 'pointer', phase: 'up', ...point });
        });
    }

    async swipe(caller: string, device: DeviceInfo, from: Pixel, to: Pixel, ms = SWIPE_DEFAULT_MS): Promise<void> {
        const start = this.normalized(device, from);
        const end = this.normalized(device, to);
        const steps = Math.max(2, Math.round(ms / SWIPE_STEP_MS));
        await this.operate(caller, device, { kind: 'swipe' }, async (send) => {
            await send({ kind: 'pointer', phase: 'down', ...start });
            let at = start;
            for (let step = 1; step <= steps; step += 1) {
                await this.sleep(ms / steps);
                const refusal = this.gate.recheck(device);
                if (refusal !== null) {
                    // The finger comes up where it got to, or it would stay on the glass under the person's hand.
                    await send({ kind: 'pointer', phase: 'up', ...at });
                    throw new CodedError(refusal.code, refusal.message);
                }
                const share = step / steps;
                at = { x: start.x * (1 - share) + end.x * share, y: start.y * (1 - share) + end.y * share };
                await send({ kind: 'pointer', phase: 'move', ...at });
            }
            await send({ kind: 'pointer', phase: 'up', ...end });
        });
    }

    async button(caller: string, device: DeviceInfo, button: DeviceButton): Promise<void> {
        await this.operate(caller, device, { kind: 'button', button }, (send) => send({ kind: 'button', button }));
    }

    async type(caller: string, device: DeviceInfo, text: string): Promise<void> {
        if (!this.manager.canType(device)) {
            throw new CodedError('device-input-unavailable', `Ruimte cannot type on ${device.name}`);
        }
        this.pass(caller, device, { kind: 'type' });
        const holder = `agent:${caller}`;
        let held = false;
        try {
            await this.manager.type(device.backendId, device.platform, device.deviceId, text, async () => {
                await this.hold(device, holder);
                held = true;
                return {
                    keys: (usages) => this.manager.keys(device.backendId, device.deviceId, holder, usages),
                    paste: (run) => this.manager.paste(device.backendId, device.deviceId, holder, run)
                };
            });
        } finally {
            if (held) {
                this.keep(device, holder);
            }
        }
    }

    async launch(caller: string, device: DeviceInfo, app: string): Promise<void> {
        this.pass(caller, device, { kind: 'launch', app });
        await this.manager.action({ action: 'launchApp', appId: app, backendId: device.backendId, platform: device.platform, deviceId: device.deviceId });
    }

    /*
     * Runs one or more actions of a tool as one step: the person sees it on the strip and may pause it
     * first. An action the device does not announce the tool of is refused before any of them runs.
     */
    async act(caller: string, device: DeviceInfo, step: ToolStepKind, bodies: readonly DeviceActionBody[]): Promise<void> {
        const tools = deviceTools(device);
        for (const body of bodies) {
            const tool = ACTION_TOOLS[body.action];
            if (tool === undefined || !tools.includes(tool)) {
                throw new CodedError('device-action-unavailable', `${device.name} has no ${tool ?? body.action} tool in Ruimte`, [
                    `note\tIt announces: ${tools.join(' ') || 'nothing'}`
                ]);
            }
        }
        this.pass(caller, device, { kind: step });
        for (const body of bodies) {
            await this.manager.action({ ...body, backendId: device.backendId, platform: device.platform, deviceId: device.deviceId } as DeviceAction);
        }
    }

    /* Reads the device clipboard (never an iOS simulator's), or writes it with `text`; an Android device reaches its clipboard only through a session, which this holds. */
    async clipboard(caller: string, device: DeviceInfo, text: string | null): Promise<string> {
        if (!deviceTools(device).includes('clipboard')) {
            throw new CodedError('device-action-unavailable', `Ruimte cannot reach the clipboard of ${device.name}`);
        }
        // Simulator.app keeps the simulator's pasteboard in step with the Mac's, so reading it would read what the person copied.
        if (text === null && device.platform === 'ios') {
            throw new CodedError('device-action-unavailable', `An agent cannot read the clipboard of ${device.name}, which follows the clipboard of this Mac`, [
                'note\tPutting text there with --text still works'
            ]);
        }
        this.pass(caller, device, { kind: 'clipboard' });
        const holder = `agent:${caller}`;
        await this.hold(device, holder);
        try {
            return await this.manager.clipboard(device.backendId, device.platform, device.deviceId, holder, text ?? undefined);
        } finally {
            this.keep(device, holder);
        }
    }

    /* Records the screen for `seconds` and answers the video, in the machine's captures and outside the project. */
    async record(caller: string, device: DeviceInfo, seconds: number, id: string): Promise<string> {
        if (!deviceTools(device).includes('record')) {
            throw new CodedError('device-action-unavailable', `Ruimte cannot record ${device.name}`);
        }
        this.pass(caller, device, { kind: 'record' });
        const file = await captureFile(this.home, id, 'mp4');
        await this.manager.startRecording(device.backendId, device.platform, device.deviceId, file);
        await this.sleep(Math.min(seconds, AGENT_RECORDING_MAX_SECONDS) * 1000);
        return this.manager.stopRecording(device.backendId, device.platform, device.deviceId);
    }

    /* Every hold ended at once, for a daemon that stops; the sessions themselves close with the manager. */
    releaseAll(): void {
        for (const [key, hold] of [...this.holds]) {
            this.drop(key, hold);
        }
        for (const [key, reading] of [...this.readings]) {
            this.dropReading(key, reading);
        }
    }

    private pass(caller: string, device: DeviceInfo, step: AgentStep): void {
        const refusal = this.gate.admit(device, caller, step);
        if (refusal !== null) {
            throw new CodedError(refusal.code, refusal.message);
        }
        const key = deviceKey(device);
        const reading = this.readings.get(key);
        if (reading) {
            this.keepReading(key, reading);
        }
    }

    private keepReading(key: string, reading: Reading): void {
        reading.cancel();
        reading.cancel = this.timers.set(() => this.dropReading(key, reading), AGENT_HOLD_IDLE_MS);
        this.readings.set(key, reading);
    }

    private dropReading(key: string, reading: Reading): void {
        if (this.readings.get(key) !== reading) {
            return;
        }
        reading.cancel();
        this.readings.delete(key);
        this.manager.closeTree(reading.device.backendId, reading.device.deviceId);
    }

    /* A pixel of the last shot as the share of the screen the device takes, refused when there is no shot to count it in. */
    private normalized(device: DeviceInfo, at: Pixel): { x: number; y: number } {
        const size = this.screen(device);
        if (size === null) {
            throw new CodedError('no-shot', `There is no shot of ${device.name} yet, and coordinates are pixels of the last one`, [
                'see\truimte-context device shot <id>\ttakes one'
            ]);
        }
        if (at.x >= size.width || at.y >= size.height) {
            throw new CodedError('outside-shot', `${at.x},${at.y} lies outside the last shot of ${device.name}, which is ${size.width}x${size.height}`);
        }
        return { x: at.x / size.width, y: at.y / size.height };
    }

    /* Holds the device for this caller, runs the gesture on it, and keeps the hold for a while after. */
    private async operate(
        caller: string,
        device: DeviceInfo,
        step: AgentStep,
        gesture: (send: (input: DeviceInput) => Promise<void>) => Promise<void>
    ): Promise<void> {
        if (!device.capabilities.input) {
            throw new CodedError('device-input-unavailable', `${device.name} takes no input from Ruimte on this machine`);
        }
        this.pass(caller, device, step);
        const holder = `agent:${caller}`;
        await this.hold(device, holder);
        try {
            await gesture((input) => this.manager.input(device.backendId, device.deviceId, holder, input));
        } finally {
            this.keep(device, holder);
        }
    }

    private async hold(device: DeviceInfo, holder: string): Promise<void> {
        await this.manager.hold(device.backendId, device.platform, device.deviceId, holder);
        this.keep(device, holder);
    }

    private keep(device: DeviceInfo, holder: string): void {
        const key = `${deviceKey(device)}\u0000${holder}`;
        this.holds.get(key)?.cancel();
        const hold: Hold = { device, holder, cancel: () => undefined };
        hold.cancel = this.timers.set(() => this.drop(key, hold), AGENT_HOLD_IDLE_MS);
        this.holds.set(key, hold);
    }

    private drop(key: string, hold: Hold): void {
        if (this.holds.get(key) !== hold) {
            return;
        }
        hold.cancel();
        this.holds.delete(key);
        this.manager.release(hold.device.backendId, hold.device.deviceId, hold.holder);
    }
}
