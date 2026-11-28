import type { MachineCandidate } from '@ruimte/contracts';

/* A folder a person picked to open in a dev container, and how far the app is with the machine it starts there. */
export interface DevcontainerStart {
    /* What the page names the start by. The shell keeps the folder behind it, so no page names a path to run in. */
    id: string;
    /* The folder on this computer, for a person to read. */
    folder: string;
    candidate: MachineCandidate;
    /* Where the project folder is on the new machine; null while the file was not read or could not be. */
    workspaceFolder: string | null;
    /* The new machine, once it signed itself onto the account. */
    machineId: string | null;
}

/*
 * A machine of Ruimte in the dev container of a folder, which an app without a machine of its own starts with Docker
 * itself. The shell reads the folder's devcontainer.json, shows what would run, and runs it after the page's yes to
 * exactly that. The new machine then signs itself onto the account the page is signed in to, and the page posts that
 * with its own session. Only on macOS and Linux, in machine mode `none`.
 */
export interface DevcontainerBridge {
    /* Shows a folder picker and reads what the picked folder would run; null when the person cancelled. */
    pick(accountId: string): Promise<DevcontainerStart | null>;
    list(): Promise<DevcontainerStart[]>;
    /* Runs what was shown under `digest`. A folder that would run something else by now is shown again, and runs nothing. */
    start(id: string, accountId: string, digest: string): Promise<DevcontainerStart>;
    /* Asks the program that runs to end, once. Nothing a start made is removed. */
    stop(id: string): Promise<void>;
    /* What the new machine signed for `accountId`, unknown since it crossed a process boundary. */
    registration(id: string, accountId: string): Promise<unknown>;
    /* The page posted the registration, so the start is over. */
    joined(id: string): Promise<void>;
    onChanged(listener: (start: DevcontainerStart) => void): () => void;
}
