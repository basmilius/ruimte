import { MACHINE_STATUS_PATH, MachineStatusSchema, type MachineStatus } from '@ruimte/contracts';
import { DEFAULT_PORT } from '../config.ts';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/* What a command tells a person whose daemon is not running, with the port flag when it is not the default one. */
export const startFirst = (port: number): string => {
    const flag = port === DEFAULT_PORT ? '' : ` --port ${port}`;
    return `Start it with \`ruimte service install${flag}\`, or with \`ruimte${flag}\` in another terminal.`;
};

export type StatusAnswer = { status: MachineStatus } | { problem: 'not-running' | 'other-home' | 'too-old' };

/* Asks the daemon on `port` how clients reach it, on the local secret of the home this command runs with. */
export const readMachineStatus = async (port: number, secret: string, fetcher: Fetch): Promise<StatusAnswer> => {
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
};

const doorAddresses = (lan: NonNullable<MachineStatus['lan']>): string => lan.addresses.map((address) => `${address}:${lan.port}`).join(', ');

/* The one sentence `ruimte login` ends on: which ways clients on the account now have to this machine. */
export const reachSentence = (status: MachineStatus): string => {
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
};

/* What `ruimte status` prints: one line per way in, and a warning when there is none. */
export const statusLines = (status: MachineStatus, port: number): string[] => {
    const { lan, broker } = status;
    const lines = [
        `Ruimte ${status.version} on port ${port}, ${status.service ? 'as the background service' : 'started by hand'}`,
        `Name      ${status.label}`,
        `Account   ${status.onAccount ? 'on an account' : `none yet, \`ruimte login${port === DEFAULT_PORT ? '' : ` --port ${port}`}\` puts it on yours`}`,
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
    if (broker.url === null && (lan === null || lan.addresses.length === 0)) {
        lines.push('', 'No client elsewhere can reach this machine: the broker is off, and nothing on the local network can reach it either.');
    }
    return lines;
};
