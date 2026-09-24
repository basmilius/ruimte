import type { DeviceAgentStep, DeviceControlMode, DeviceInfo, DeviceOperated } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { realTimers, type Timers } from '../computer/approvals.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { AGENT_HOLD_IDLE_MS, type AgentStep, type DeviceGate } from './agent-driver.ts';

type Mode = 'running' | 'paused' | 'takenOver';

type Target = Pick<DeviceInfo, 'backendId' | 'deviceId'>;

interface Entry {
    backendId: string;
    deviceId: string;
    nodeId: string | null;
    mode: Mode;
    step: DeviceAgentStep | null;
    // Whether the agent still calls; a pause outlives it, the rest ends with it.
    live: boolean;
    cancel: () => void;
}

/* The person holds the device. The words steer the agent to wait or to stop, never to find another way in. */
const heldWords = (mode: Exclude<Mode, 'running'>, name: string): string =>
    mode === 'paused'
        ? `The person paused you on ${name}. Wait a while and call again, which works once they resume, and take a shot first: they may have changed the screen. Or stop here and tell them what is left`
        : `The person took over ${name} and operates it by hand. Wait a while and call again, which works once they hand it back, and take a shot first: they may have changed the screen. Or stop here and tell them what is left`;

const HELD_CODES: Record<Exclude<Mode, 'running'>, string> = { paused: 'paused', takenOver: 'taken-over' };

const keyOf = (device: Target): string => `${device.backendId}\u0000${device.deviceId}`;

/* A step in the words a client that does not know its kind still shows. */
export const describeStep = (step: AgentStep): string => {
    switch (step.kind) {
        case 'button':
            return `button ${step.button}`;
        case 'launch':
            return `launch ${step.app}`;
        default:
            return step.kind;
    }
};

const wireStep = (step: AgentStep, seq: number): DeviceAgentStep => {
    const target = step.kind === 'button' ? step.button : step.kind === 'launch' ? step.app : undefined;
    return {
        kind: step.kind,
        ...(target === undefined ? {} : { target }),
        description: describeStep(step),
        ...(step.kind === 'tap' ? { x: step.x, y: step.y } : {}),
        seq
    };
};

const payloadOf = (entry: Entry, state: DeviceOperated['state'] = entry.mode): DeviceOperated => ({
    backendId: entry.backendId,
    deviceId: entry.deviceId,
    nodeId: entry.nodeId,
    state,
    step: entry.step
});

/*
 * Who has each device an agent operates, in memory: the agent, or the person who paused it or took
 * over from its node. Every client hears each change (`device.operated`), and the gate refuses the
 * agent's steps while the person holds the device. An operation lasts as long as the agent's hold,
 * a refused call included, so a take-over ends when the agent stops asking; a pause waits for the
 * person, since only they said when the agent may go on.
 */
export class DeviceControl implements DeviceGate {
    private readonly timers: Timers;
    private readonly sinks = new ClientSinks();
    private readonly entries = new Map<string, Entry>();
    private seq = 0;

    constructor(options: { timers?: Timers } = {}) {
        this.timers = options.timers ?? realTimers;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    list(): DeviceOperated[] {
        return [...this.entries.values()].map((entry) => payloadOf(entry));
    }

    admit(device: DeviceInfo, caller: string, step: AgentStep): { code: string; message: string } | null {
        const key = keyOf(device);
        const entry = this.entries.get(key) ?? this.open(key, device);
        this.keep(key, entry);
        if (entry.mode !== 'running') {
            // A shot changes nothing on the device, so the agent may still look while the person has it.
            if (step.kind === 'shot') {
                return null;
            }
            return { code: HELD_CODES[entry.mode], message: heldWords(entry.mode, device.name) };
        }
        entry.nodeId = caller;
        entry.step = wireStep(step, this.seq++);
        this.emit(payloadOf(entry));
        return null;
    }

    /* A press on the strip; answers how the device stands after it, `ended` when no agent operates it. */
    control(target: Target, mode: DeviceControlMode): DeviceOperated {
        const key = keyOf(target);
        const entry = this.entries.get(key);
        if (!entry) {
            return { backendId: target.backendId, deviceId: target.deviceId, nodeId: null, state: 'ended', step: null };
        }
        entry.mode = mode === 'pause' ? 'paused' : mode === 'takeOver' ? 'takenOver' : 'running';
        if (!entry.live && entry.mode !== 'paused') {
            return this.end(key, entry);
        }
        const payload = payloadOf(entry);
        this.emit(payload);
        return payload;
    }

    /* Every timer stopped, for a daemon that stops; nobody is told, since every socket goes with it. */
    stop(): void {
        for (const entry of this.entries.values()) {
            entry.cancel();
        }
        this.entries.clear();
    }

    private open(key: string, device: Target): Entry {
        const entry: Entry = {
            backendId: device.backendId,
            deviceId: device.deviceId,
            nodeId: null,
            mode: 'running',
            step: null,
            live: true,
            cancel: () => undefined
        };
        this.entries.set(key, entry);
        return entry;
    }

    private keep(key: string, entry: Entry): void {
        entry.cancel();
        entry.live = true;
        entry.cancel = this.timers.set(() => this.idle(key, entry), AGENT_HOLD_IDLE_MS);
    }

    private idle(key: string, entry: Entry): void {
        if (this.entries.get(key) !== entry) {
            return;
        }
        entry.live = false;
        if (entry.mode !== 'paused') {
            this.end(key, entry);
        }
    }

    private end(key: string, entry: Entry): DeviceOperated {
        entry.cancel();
        this.entries.delete(key);
        const payload = payloadOf(entry, 'ended');
        this.emit(payload);
        return payload;
    }

    private emit(payload: DeviceOperated): void {
        this.sinks.emit({ event: 'device.operated', payload });
    }
}
