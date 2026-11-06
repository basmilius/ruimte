/*
 * A switch about agents that lives in the machine's own `endpoint.json`, since the daemon is what acts
 * on it and a client-side switch would hold nothing back.
 */
export type MachineSwitch = 'agentsDeleteAnyView' | 'reachOpenProjects' | 'resumeAtReset' | 'visualReplies';

export const MACHINE_SWITCHES: readonly MachineSwitch[] = ['resumeAtReset', 'visualReplies', 'agentsDeleteAnyView', 'reachOpenProjects'];
