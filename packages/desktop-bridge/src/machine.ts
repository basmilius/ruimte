/*
 * Whether this app runs a machine of its own. `ask` is a new install that has not been told yet and
 * runs no machine either.
 */
export type MachineMode = 'local' | 'none' | 'ask';

export interface MachineWorkCount {
    terminals: number;
    agents: number;
}

export interface MachineStopPreview {
    /* What ends, as the quit question counts it; null when the machine cannot say. */
    work: MachineWorkCount | null;
    /* `$RUIMTE_HOME` with the home folder written as `~`, which stays as it is. */
    home: string;
    /* The machine is a service `npx ruimte service install` set up, which keeps running. */
    commandLine: boolean;
}

export interface MachineModeBridge {
    mode: MachineMode;
    /* What a switch to `none` ends. In `none` and `ask` there is no work and nothing to say. */
    stopPreview(): Promise<MachineStopPreview>;
    /* Writes the choice and restarts the app. From `local` to `none` the service the app owns stops and goes, as "Stop Machine and Quit" does. Rejects when the choice could not be written, and then nothing stopped. */
    choose(mode: 'local' | 'none'): Promise<void>;
}
