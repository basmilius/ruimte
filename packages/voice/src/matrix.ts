import { voiceToolsForActions, type ActionDomain, type ActionName, type VoiceToolDefinition } from '@ruimte/actions';

export interface DaemonVoiceAction {
    name: ActionName;
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
        name: 'project.list',
        confirms: false,
        description: 'Lists the projects in use on this machine; the one Voice works in now is active. Voice works only in the projects of this machine.'
    },
    {
        name: 'project.switch',
        confirms: false,
        description:
            'Makes another project in use on this machine the one Voice works in, by the endpointId and projectId project.list gives. Every other action then reads and acts in that project. Nothing opens on the phone.'
    },
    {
        name: 'workspace.inspect',
        confirms: false,
        description:
            'Reads the project Voice works in now: its views, and the nodes of the canvas actions land on with what each chat and terminal agent does. A phone has no split cells or selection and the machine does not see its screen, so those come back under unknown.'
    },
    {
        name: 'target.resolve',
        confirms: false,
        description:
            'Turns spoken names of views, nodes on the canvas actions land on, AI Chats or agents anywhere in the project Voice works in now, or projects in use on this machine into ids. A name that fits more than one comes back under ambiguous with every candidate, never as the first of them. Without names only the canvas actions land on and the current project resolve: a phone has no selection, so a node, a chat or an agent is always named. nodeKind narrows nodes.'
    },
    { name: 'chat.read', confirms: false },
    {
        name: 'chat.inspect',
        confirms: false,
        description:
            'Reads what an AI Chat of the current project runs on and what waits in it: CLI, model and options, permission mode, whether a turn runs, queued messages, questions and approvals waiting for the user (an approval by its tool and description only), sub-agents, background tasks by their description, the last finished turn and where a fork came from.'
    },
    { name: 'agents.inspect', confirms: false, description: 'Reads what every AI Chat and terminal agent of the current project does now.' },
    {
        name: 'chat.send',
        confirms: false,
        description:
            'Sends a prompt to an AI Chat of the current project that runs on the machine, to steer its turn or queue behind it. The machine follows the turn the prompt opens and reports when it ends.'
    },
    {
        name: 'chat.clear',
        confirms: true,
        description:
            'Clears an AI Chat of the current project that runs on the machine, only when the user explicitly asks to clear or reset it: removes its history, attachments and plans and stops its current turn, and keeps its node or view. It asks the user first, and the phone shows the question too. Never send /clear as a prompt instead.'
    },
    {
        name: 'agent.start',
        confirms: false,
        description:
            'Starts a new AI Chat in the current project with this CLI and first prompt, on the canvas actions land on, or as a view of its own in a project without a canvas. It runs supervised. The machine reports when the chat is made, when its first turn starts and when that turn ends.'
    }
];

/* What each tool of the daemon says of itself. */
const DOMAIN_WORDS: Readonly<Partial<Record<ActionDomain, string>>> = {
    projects: 'List the projects in use on this machine, or move Voice to one of them.',
    workspace: 'Read the current project, its views and the canvas actions land on, or resolve spoken names to the ids every other tool takes.',
    communicate: 'Read the recent messages of an AI Chat of the current project, send it a prompt, or clear it.',
    sessions: 'Read what an AI Chat of the current project runs on and what waits in it. Approvals are the user’s to answer in the app.',
    agents: 'Read what the agents of the current project do, or start a new AI Chat.'
};

export function daemonVoiceTools(): VoiceToolDefinition[] {
    return voiceToolsForActions(
        DAEMON_VOICE_ACTIONS.map((action) => action.name),
        {
            control: DAEMON_VOICE_ACTIONS.some((action) => action.confirms),
            words: {
                domains: DOMAIN_WORDS,
                actions: Object.fromEntries(
                    DAEMON_VOICE_ACTIONS.flatMap((action) => (action.description === undefined ? [] : [[action.name, action.description]]))
                )
            }
        }
    );
}
