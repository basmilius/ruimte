import { deviceTools, type DeviceButton, type DeviceInfo, type DeviceInput, type DeviceReference } from '@ruimte/contracts';
import { realTimers, type Timers } from '../computer/approvals.ts';
import { CodedError } from '../coded-error.ts';
import { pngSize, writeShot } from '../shots.ts';
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
}

/* One step of an agent on a device; a tap in the share of the screen from its top-left corner. */
export type AgentStep =
    | { kind: 'tap'; x: number; y: number }
    | { kind: 'swipe' }
    | { kind: 'type' }
    | { kind: 'button'; button: DeviceButton }
    | { kind: 'launch'; app: string }
    | { kind: 'shot' };

/*
 * Whether a person lets an agent take a step on a device right now. The one place a pause or a
 * take-over from the node answers, so every step passes it before it touches the device; a shot
 * passes it as well, so the person sees it, and is left to the gate to let through.
 */
export interface DeviceGate {
    admit(device: DeviceInfo, caller: string, step: AgentStep): { code: string; message: string } | null;
}

export const OPEN_GATE: DeviceGate = { admit: () => null };

type Manager = Pick<DeviceManager, 'find' | 'hold' | 'release' | 'input' | 'keys' | 'canType' | 'type' | 'screenshot' | 'action'>;

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

const deviceKey = (device: Pick<DeviceInfo, 'backendId' | 'deviceId'>): string => `${device.backendId}\u0000${device.deviceId}`;

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

    constructor(options: DeviceDriverOptions) {
        this.home = options.home;
        this.manager = options.manager;
        this.timers = options.timers ?? realTimers;
        this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
        this.gate = options.gate ?? OPEN_GATE;
    }

    find(reference: DeviceReference): Promise<DeviceInfo | null> {
        return this.manager.find(reference);
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
            launch: booted && deviceTools(device).includes('launchApp')
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
        const point = this.normalized(device, at);
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
            for (let step = 1; step <= steps; step += 1) {
                await this.sleep(ms / steps);
                const share = step / steps;
                await send({ kind: 'pointer', phase: 'move', x: start.x * (1 - share) + end.x * share, y: start.y * (1 - share) + end.y * share });
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
                return (usages) => this.manager.keys(device.backendId, device.deviceId, holder, usages);
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

    /* Every hold ended at once, for a daemon that stops; the sessions themselves close with the manager. */
    releaseAll(): void {
        for (const [key, hold] of [...this.holds]) {
            this.drop(key, hold);
        }
    }

    private pass(caller: string, device: DeviceInfo, step: AgentStep): void {
        const refusal = this.gate.admit(device, caller, step);
        if (refusal !== null) {
            throw new CodedError(refusal.code, refusal.message);
        }
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
