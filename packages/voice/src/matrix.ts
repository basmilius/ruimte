import { voiceToolsForActions, type ActionName, type VoiceToolDefinition } from '@ruimte/actions';

export interface DaemonVoiceAction {
    name: ActionName;
    /*
     * Prompts a chat or starts one. Until the decision on what Voice may change, these are offered only
     * while the daemon also runs with RUIMTE_EXPERIMENTAL_VOICE_WRITES=1; without it Voice only reads.
     */
    writes: boolean;
    /* Asks the person before it runs, so a session that offers it also offers the control tool. */
    confirms: boolean;
}

/*
 * Every action Voice may run through the daemon, and nothing else: the daemon's policy is derived from
 * this list, and a tool call naming any other action is refused before it reaches the registry. An action
 * the catalog does not yet open to Voice (agent.start keeps `actors: AGENT` until the start for Voice is
 * bounded per field) stays out of the tools until it does.
 */
export const DAEMON_VOICE_ACTIONS: readonly DaemonVoiceAction[] = [
    { name: 'workspace.inspect', writes: false, confirms: false },
    { name: 'target.resolve', writes: false, confirms: false },
    { name: 'chat.read', writes: false, confirms: false },
    { name: 'chat.inspect', writes: false, confirms: false },
    { name: 'agents.inspect', writes: false, confirms: false },
    { name: 'chat.send', writes: true, confirms: false },
    { name: 'agent.start', writes: true, confirms: false }
];

export interface DaemonVoiceGrant {
    /* RUIMTE_EXPERIMENTAL_VOICE_WRITES: the actions that prompt or start a chat are on too. */
    writes: boolean;
}

export function daemonVoiceActions({ writes }: DaemonVoiceGrant): DaemonVoiceAction[] {
    return DAEMON_VOICE_ACTIONS.filter((action) => writes || !action.writes);
}

export function daemonVoiceTools(grant: DaemonVoiceGrant): VoiceToolDefinition[] {
    const actions = daemonVoiceActions(grant);
    return voiceToolsForActions(
        actions.map((action) => action.name),
        { control: actions.some((action) => action.confirms) }
    );
}
