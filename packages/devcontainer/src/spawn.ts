/* A program as it is described, with each argument as it reaches the program: no shell reads it. */
export interface Spawn {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

export interface Step {
    /* What it does, in words a person reads above its output. */
    title: string;
    spawn: Spawn;
}

/*
 * What brings up the container with a machine of Ruimte in it, in the shape a machine source answers: the programs in
 * order, how a command runs where the new machine lives, and a digest of the files they were read from.
 */
export interface Start {
    steps: Step[];
    inside: Spawn;
    fingerprint: string;
}
