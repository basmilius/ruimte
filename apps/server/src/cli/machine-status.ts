import { CLOSED_LID_BATTERY_FLOOR, MACHINE_STATUS_PATH, MachineStatusSchema, type MachineStatus } from '@ruimte/contracts';
import { portFlag } from '../config.ts';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/* What a command tells a person whose daemon is not running. */
export function startFirst(port: number): string {
    const flag = portFlag(port);
    return `Start it with \`ruimte service install${flag}\`, or with \`ruimte${flag}\` in another terminal.`;
}

export type StatusAnswer = { status: MachineStatus } | { problem: 'not-running' | 'other-home' | 'too-old' };

/* Asks the daemon on `port` how clients reach it, on the local secret of the home this command runs with. */
export async function readMachineStatus(port: number, secret: string, fetcher: Fetch): Promise<StatusAnswer> {
    const response = await fetcher(`http://127.0.0.1:${port}${MACHINE_STATUS_PATH}`, { method: 'GET', headers: { authorization: `Bearer ${secret}` } }).catch(
        () => null
    );
    if (!response) {
        return { problem: 'not-running' };
    }
    if (response.status === 404) {
        return { problem: 'too-old' };
    }
    if (!response.ok) {
        return { problem: 'other-home' };
    }
    const parsed = MachineStatusSchema.safeParse(await response.json().catch(() => null));
    return parsed.success ? { status: parsed.data } : { problem: 'too-old' };
}

function doorAddresses(lan: NonNullable<MachineStatus['lan']>): string {
    return lan.addresses.map((address) => `${address}:${lan.port}`).join(', ');
}

/* The one sentence `ruimte login` ends on: which ways clients on the account now have to this machine. */
export function reachSentence(status: MachineStatus): string {
    const { lan, broker } = status;
    const local = lan !== null && lan.addresses.length > 0 ? doorAddresses(lan) : null;
    if (local !== null && broker.url !== null) {
        return `On this network they connect to it directly at ${local}, and from anywhere else through ${broker.url}.`;
    }
    if (local !== null) {
        return `Only on this network, directly at ${local}: the broker is off.`;
    }
    if (broker.url !== null) {
        return `They connect to it through ${broker.url}; the door on the local network is closed.`;
    }
    return 'No client can reach it yet: the broker is off, and so is the door on the local network.';
}

type KeepAwakeStatus = NonNullable<MachineStatus['keepAwake']>;

function awakeLine(keepAwake: KeepAwakeStatus): string {
    if (keepAwake.mode === 'off') {
        return 'off';
    }
    const when = keepAwake.mode === 'always' ? 'always' : 'while agents work';
    const where = keepAwake.onBattery ? 'on battery too' : 'on the power adapter only';
    return `${when}, ${where}; ${keepAwake.holding ? 'holding now' : 'not holding now'}`;
}

/* The closed lid in one phrase, for `ruimte status` and after `ruimte closed-lid install`; null where it is not offered. */
export function lidLine(keepAwake: KeepAwakeStatus): string | null {
    const { lid } = keepAwake;
    if (lid === null) {
        return null;
    }
    if (!lid.rule) {
        return 'a closed lid sleeps this Mac; `ruimte closed-lid install` lets keep awake hold it';
    }
    if (!lid.on) {
        return 'allowed but off, so a closed lid sleeps this Mac';
    }
    if (lid.holding) {
        return 'sleep is off, so this Mac stays awake with the lid closed';
    }
    const power = keepAwake.onBattery ? `on the power adapter, or on battery from ${CLOSED_LID_BATTERY_FLOOR}% up` : 'on the power adapter';
    return `on, not holding now: it holds while keep awake does, ${power}`;
}

/* What `ruimte status` prints: one line per way in, and a warning when there is none. */
export function statusLines(status: MachineStatus, port: number): string[] {
    const { lan, broker } = status;
    const lines = [
        `Ruimte ${status.version} on port ${port}, ${status.service ? 'as the background service' : 'started by hand'}`,
        `Name      ${status.label}`,
        `Account   ${status.onAccount ? 'on an account' : `none yet, \`ruimte login${portFlag(port)}\` puts it on yours`}`,
        `Broker    ${broker.url === null ? 'off' : `${broker.url}, ${broker.connected ? 'connected' : 'not connected yet'}`}`,
        `Network   ${
            lan === null
                ? status.lanDoorFixed
                    ? 'closed by --no-lan'
                    : 'closed under Settings, Machines'
                : lan.addresses.length > 0
                  ? doorAddresses(lan)
                  : `open on port ${lan.port}, but this machine has no address on a local network`
        }`
    ];
    if (status.keepAwake) {
        lines.push(`Awake     ${awakeLine(status.keepAwake)}`);
        const lid = lidLine(status.keepAwake);
        if (lid !== null) {
            lines.push(`Lid       ${lid}`);
        }
    }
    if (broker.url === null && (lan === null || lan.addresses.length === 0)) {
        lines.push('', 'No client elsewhere can reach this machine: the broker is off, and nothing on the local network can reach it either.');
    }
    return lines;
}
