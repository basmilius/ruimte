import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_STUN_SERVER, brokerUrlProblem, type BrokerOverride } from '@ruimte/pulsar';
import { RUIMTE_SESSION_VARIABLES } from '@ruimte/agents/host/environment';

export interface ServerConfig {
    host: string;
    port: number;
    home: string;
    // Whether to put the status hooks into the CLIs' settings files at startup.
    installHooks: boolean;
    // What this daemon calls itself towards clients.
    label: string;
    // Whether the daemon may ask LiteLLM for the price table; off leaves it on the bundled snapshot.
    priceFetch: boolean;
    // Whether the daemon may ask the address book for newer model catalogs; off leaves the shipped ones.
    modelFetch: boolean;
    // The STUN servers a direct connection gathers its public address from; empty announces the interfaces only.
    stun: string[];
    // The UDP ports a direct connection binds, for a firewall or a container that publishes a fixed range.
    directPorts: [number, number] | null;
    // Addresses announced as candidates on top of the interfaces, such as the one a container is published on.
    directHostAddresses: string[];
    // A broker forced by `--broker`, `--no-broker` or `RUIMTE_BROKER_URL`; null leaves it to the machine's setting and then the default.
    broker: BrokerOverride;
    // The broker URL clients are told to dial, when it is not the one this machine dials (a container reaching the host by another name).
    brokerAdvertise: string | null;
    // The port of the door on the local network (`src/pulsar/lan-door.ts`); 0 lets the system pick one.
    lanPort: number;
    // `--no-lan`: the door stays closed whatever the machine's setting says.
    lanDoorOff: boolean;
    // Started by the background service (`RUIMTE_SERVICE=1` in its definition), which starts it again when it exits.
    underService: boolean;
    // `login` puts it on an account with a code; `status` says how the running daemon is reached; `context` is the agent-side CLI (`ruimte-context`);
    // `service` installs, removes or reports the background service; `closed-lid` installs or removes the sudoers rule behind keep awake
    // with the lid closed; `version` prints the version; `pair` only says that pairing links are gone.
    command: 'serve' | 'pair' | 'login' | 'logout' | 'status' | 'context' | 'service' | 'closed-lid' | 'version';
    // What follows the command: the words of `context`, and the action of `service` followed by the daemon flags its service runs with.
    args: string[];
}

/*
 * What a session hands its shell. A daemon started from inside another daemon's terminal inherits
 * them, and its own sessions and usage probes would then report into that other daemon's node.
 */
export const SESSION_VARIABLES = RUIMTE_SESSION_VARIABLES;

/** Removes the variables of a session this process was started from; a daemon never belongs to one. */
export function forgetInheritedSession(env: Record<string, string | undefined>): void {
    for (const name of SESSION_VARIABLES) {
        delete env[name];
    }
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4210;

// The door on the local network listens this far above the daemon's port: 4220 beside 4210, 4221 beside a dev daemon on 4211.
const LAN_PORT_OFFSET = 10;

/* The door's port when no flag names one; a daemon on a port the system picked gets a door on one too. */
export function defaultLanPort(port: number): number {
    return port === 0 || port + LAN_PORT_OFFSET > 65535 ? 0 : port + LAN_PORT_OFFSET;
}

/* `4330-4339` as the first and last port; one port on its own is a range of one. */
export function parsePortRange(value: string): [number, number] {
    const [first, last = first] = value.split('-').map((part) => Number(part.trim()));
    const valid = (port: number | undefined): port is number => port !== undefined && Number.isInteger(port) && port > 0 && port <= 65535;
    if (!valid(first) || !valid(last) || last < first) {
        throw new Error(`Invalid --direct-ports: ${value}`);
    }
    return [first, last];
}

/* A broker URL, or null for nothing at all; an empty value is nothing, so compose can pass an unset variable through. */
export function parseBrokerUrl(value: string | undefined, flag: string): string | null {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '') {
        return null;
    }
    const problem = brokerUrlProblem(trimmed);
    if (problem !== null) {
        throw new Error(`Invalid ${flag}: ${trimmed} (${problem})`);
    }
    return trimmed;
}

/* `--no-broker` and the word `off` turn the broker off whatever the machine's setting says; a URL picks one. */
export function parseBrokerOverride(noBroker: boolean, value: string | undefined): BrokerOverride {
    if (noBroker || value?.trim().toLowerCase() === 'off') {
        return { mode: 'off' };
    }
    const url = parseBrokerUrl(value, '--broker');
    return url === null ? null : { mode: 'custom', url };
}

export function parseServerArgs(argv: string[], env: Record<string, string | undefined> = process.env): ServerConfig {
    // Everything after `context` belongs to the agent's CLI (`node note --text ...`), whose flags the daemon parses, not this.
    const cli = argv[0] === 'context';
    const { values, positionals } = parseArgs({
        args: cli ? argv.slice(0, 1) : argv,
        options: {
            host: { type: 'string', default: DEFAULT_HOST },
            port: { type: 'string', default: String(DEFAULT_PORT) },
            'no-hooks': { type: 'boolean', default: false },
            // todo(bas): drop one release after the shell served its own page; a service definition from before still passes it.
            serve: { type: 'string' },
            label: { type: 'string' },
            'no-price-fetch': { type: 'boolean', default: false },
            'no-model-fetch': { type: 'boolean', default: false },
            stun: { type: 'string', multiple: true, default: [] },
            'no-stun': { type: 'boolean', default: false },
            'direct-ports': { type: 'string' },
            'direct-host-address': { type: 'string', multiple: true, default: [] },
            broker: { type: 'string' },
            'no-broker': { type: 'boolean', default: false },
            'broker-advertise': { type: 'string' },
            'lan-port': { type: 'string' },
            'no-lan': { type: 'boolean', default: false },
            version: { type: 'boolean', short: 'v', default: false }
        },
        strict: true,
        allowPositionals: true
    });
    const command = values.version ? 'version' : (positionals[0] ?? 'serve');
    if (
        command !== 'serve' &&
        command !== 'pair' &&
        command !== 'login' &&
        command !== 'logout' &&
        command !== 'status' &&
        command !== 'context' &&
        command !== 'service' &&
        command !== 'closed-lid' &&
        command !== 'version'
    ) {
        throw new Error(`Unknown command: ${command}`);
    }
    // The flags after `service install` are the ones the service runs the daemon with, so they are kept as written.
    const service = command === 'service';
    if (service && (argv[0] !== 'service' || positionals.length !== 2)) {
        throw new Error('Usage: ruimte service install|uninstall|status [daemon flags]');
    }

    if (command === 'closed-lid' && positionals.length !== 2) {
        throw new Error('Usage: ruimte closed-lid install|remove');
    }

    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --port: ${values.port}`);
    }
    const lanPort = values['lan-port'] === undefined ? defaultLanPort(port) : Number(values['lan-port']);
    if (!Number.isInteger(lanPort) || lanPort < 0 || lanPort > 65535 || (lanPort !== 0 && lanPort === port)) {
        throw new Error(`Invalid --lan-port: ${values['lan-port']}`);
    }

    return {
        host: values.host,
        port,
        home: env.RUIMTE_HOME ?? join(homedir(), '.ruimte'),
        installHooks: !values['no-hooks'],
        label: values.label ?? env.RUIMTE_LABEL ?? hostname(),
        priceFetch: !values['no-price-fetch'],
        modelFetch: !values['no-model-fetch'],
        stun: values['no-stun'] ? [] : values.stun.length > 0 ? values.stun : [DEFAULT_STUN_SERVER],
        directPorts: values['direct-ports'] === undefined ? null : parsePortRange(values['direct-ports']),
        directHostAddresses: values['direct-host-address'],
        broker: parseBrokerOverride(values['no-broker'], values.broker ?? env.RUIMTE_BROKER_URL),
        brokerAdvertise: parseBrokerUrl(values['broker-advertise'] ?? env.RUIMTE_BROKER_ADVERTISE_URL, '--broker-advertise'),
        lanPort,
        lanDoorOff: values['no-lan'],
        underService: env.RUIMTE_SERVICE === '1',
        command,
        args: cli || service ? argv.slice(1) : positionals.slice(1)
    };
}
