import { useServers, type ServerInfo } from '@/state/server';

/*
 * A switch about agents that lives in the machine's own `endpoint.json`, since the daemon is what acts
 * on it and a client-side switch would hold nothing back: what an agent may take away, whether a chat
 * on a limit is taken up again on a clock, and whether an agent may show a page above its reply.
 */
export type MachineSwitch = 'agentsDeleteAnyView' | 'resumeAtReset' | 'visualReplies';

/* The switches in the order the section lists them. */
export const MACHINE_SWITCHES: readonly MachineSwitch[] = ['resumeAtReset', 'visualReplies', 'agentsDeleteAnyView'];

/* A machine from before visuals keeps none, so it has no switch for them. */
export function showsMachineSwitch(setting: MachineSwitch, info: ServerInfo | undefined): boolean {
    return setting !== 'visualReplies' || (info?.visualReplies ?? null) !== null;
}

/* Whether a machine this client heard from has the switch, which is when a search may lead to it. */
export function anyMachineShows(setting: MachineSwitch): boolean {
    return Object.values(useServers.getState().byEndpoint).some((info) => showsMachineSwitch(setting, info));
}
