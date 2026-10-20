import { voiceToolsForActions, type ActionDomain, type ActionName, type VoiceToolDefinition } from '@ruimte/actions';

export interface DaemonVoiceAction {
    name: ActionName;
    /*
     * Prompts a chat or starts one. Until the decision on what Voice may change, these are offered only
     * while the daemon also runs with RUIMTE_EXPERIMENTAL_VOICE_WRITES=1; without it Voice only reads.
     */
    writes: boolean;
    /* Asks the person before it runs, so a session that offers it also offers the control tool. */
    confirms: boolean;
    /*
     * What the tool says of the action on a phone, where the catalog's words (written for a window's
     * Voice) would promise a selection, split cells or a view of the screen the machine never has.
     */
    description?: string;
}

/*
 * Every action Voice may run through the daemon, and nothing else: the daemon's policy is derived from
 * this list, and a tool call naming any other action is refused before it reaches the registry.
 */
export const DAEMON_VOICE_ACTIONS: readonly DaemonVoiceAction[] = [
    {
        name: 'workspace.inspect',
        writes: false,
        confirms: false,
        description:
            'Reads the project Voice works in: its views, and the nodes of the canvas actions land on with what each chat and terminal agent does. A phone has no split cells or selection and the machine does not see its screen, so those come back under unknown.'
    },
    {
        name: 'target.resolve',
        writes: false,
        confirms: false,
        description:
            'Turns spoken names of views, nodes on the canvas actions land on, AI Chats or agents anywhere in this project, or this project itself into ids. A name that fits more than one comes back under ambiguous with every candidate, never as the first of them. Without names only the canvas actions land on and this project resolve: a phone has no selection, so a node, a chat or an agent is always named. nodeKind narrows nodes.'
    },
    { name: 'chat.read', writes: false, confirms: false },
    {
        name: 'chat.inspect',
        writes: false,
        confirms: false,
        description:
            'Reads what an AI Chat of this project runs on and what waits in it: CLI, model and options, permission mode, whether a turn runs, queued messages, questions and approvals waiting for the user (an approval by its tool and description only), sub-agents, background tasks, the last finished turn and where a fork came from.'
    },
    { name: 'agents.inspect', writes: false, confirms: false, description: 'Reads what every AI Chat and terminal agent of this project does now.' },
    {
        name: 'chat.send',
        writes: true,
        confirms: false,
        description:
            'Sends a prompt to an AI Chat of this project that runs on the machine, to steer its turn or queue behind it. The machine follows the turn the prompt opens and reports when it ends.'
    },
    {
        name: 'agent.start',
        writes: true,
        confirms: false,
        description:
            'Starts a new AI Chat in this project with this CLI and first prompt, on the canvas actions land on, or as a view of its own in a project without a canvas. It runs supervised. The machine reports when the chat is made, when its first turn starts and when that turn ends.'
    }
];

/* What each tool of the daemon says of itself, by whether its writes are on. */
const DOMAIN_WORDS: Readonly<Record<'reads' | 'writes', Partial<Record<ActionDomain, string>>>> = {
    reads: {
        workspace: 'Read the project, its views and the canvas actions land on, or resolve spoken names to the ids every other tool takes.',
        communicate: 'Read the recent messages of an AI Chat of this project.',
        sessions: 'Read what an AI Chat of this project runs on and what waits in it. Approvals are the user’s to answer in the app.',
        agents: 'Read what the agents of this project do.'
    },
    writes: {
        workspace: 'Read the project, its views and the canvas actions land on, or resolve spoken names to the ids every other tool takes.',
        communicate: 'Read the recent messages of an AI Chat of this project, or send it a prompt.',
        sessions: 'Read what an AI Chat of this project runs on and what waits in it. Approvals are the user’s to answer in the app.',
        agents: 'Read what the agents of this project do, or start a new AI Chat.'
    }
};

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
        {
            control: actions.some((action) => action.confirms),
            words: {
                domains: DOMAIN_WORDS[grant.writes ? 'writes' : 'reads'],
                actions: Object.fromEntries(actions.flatMap((action) => (action.description === undefined ? [] : [[action.name, action.description]])))
            }
        }
    );
}
