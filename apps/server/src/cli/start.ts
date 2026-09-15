import { createServer } from 'node:net';
import { isAddressInUse, portInUseMessage, type RunningMachine } from './fatal.ts';

export interface StartDeps {
    portTaken(host: string, port: number): Promise<boolean>;
    askRunningMachine(port: number): Promise<RunningMachine | null>;
    /* Everything that touches the home, the stores or the CLIs' hooks happens in here. */
    start(): Promise<void>;
    err(line: string): void;
}

/**
 * Starts the machine unless its port is taken. The port is looked at before `start`, so a second
 * start leaves no trace in a home it shares with the first; the listen error is still caught for
 * the port taken in between. Answers the exit code of a refusal, or null once the machine runs.
 */
export const startMachine = async (address: { host: string; port: number }, deps: StartDeps): Promise<number | null> => {
    const refuse = async (): Promise<number> => {
        deps.err(portInUseMessage(address.port, await deps.askRunningMachine(address.port)));
        return 1;
    };
    // Port 0 asks for any free port, which nothing can have taken.
    if (address.port !== 0 && (await deps.portTaken(address.host, address.port))) {
        return refuse();
    }
    try {
        await deps.start();
        return null;
    } catch (e) {
        if (!isAddressInUse(e)) {
            throw e;
        }
        return refuse();
    }
};

/** Whether listening on the address fails because something already does; any other failure is left for the daemon's own listen to report. */
export const portTaken = (host: string, port: number): Promise<boolean> =>
    new Promise((resolve) => {
        const probe = createServer();
        probe.once('error', (e) => resolve(isAddressInUse(e)));
        probe.listen({ host, port, exclusive: true }, () => probe.close(() => resolve(false)));
    });
