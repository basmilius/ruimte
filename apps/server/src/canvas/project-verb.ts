import { PROJECT_PROPOSAL_LIMITS } from '@ruimte/contracts';
import { z } from 'zod';
import { PROPOSAL_CARD_MS } from '../projects/project-proposals.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { CROSSING_VERBS, reachableLines, reachableProjects } from './reach.ts';
import { SCOPE_LINE, defineAction, field, orNote, textFlag } from './verb.ts';

const PROJECT_CARD_HOURS = PROPOSAL_CARD_MS / 3_600_000;

const proposeAction = defineActionVerb('project', {
    name: 'propose',
    action: 'project.propose',
    usage: '--name <text> --reason <text> [--folder <path>]',
    params: [
        { syntax: '--name <text>', need: 'required', field: 'name' },
        { syntax: '--reason <text>', need: 'required', field: 'reason' },
        { syntax: '--folder <path>', need: 'optional', field: 'folder', more: 'absolute, on this machine; the person picks one when you leave it out' }
    ],
    detail: [
        'prints\tproposal\tid\toutcome\twhat became of the card',
        'outcome\twaiting\tthe card stands in your chat and the command does not wait for it: go on or end your turn, since a command that holds your turn would block the very move the card offers',
        'answer\tThe person answers on the card. A move shows in your next turn, which runs in the new folder and suggests nothing more; a decline closes the card',
        'outcome\tdeclined\tonly on a later suggestion: the person said no, so go on in Chats and do not suggest it again unless something changed',
        `again\tSuggesting again from the same chat is the same card, with the new name, folder and reason; a decline that came while nobody waited is told once, and a card nobody answered goes after ${PROJECT_CARD_HOURS} hours without one`,
        'makes\tNothing: the person reviews the name and folder in a dialog and decides; the chat keeps its conversation when it moves',
        'when\tOnly when the work has become something with a folder of its own, such as code that keeps growing; not for every chat',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'project propose takes no arguments; everything goes in its flags' }),
    flags: z.object({
        name: textFlag('project propose', 'name', PROJECT_PROPOSAL_LIMITS.name, 'the name of the project'),
        reason: textFlag('project propose', 'reason', PROJECT_PROPOSAL_LIMITS.reason, 'why this is a project now'),
        folder: z.string().trim().min(1).max(PROJECT_PROPOSAL_LIMITS.folder, `--folder is at most ${PROJECT_PROPOSAL_LIMITS.folder} characters`).optional()
    }),
    async run({ flags }, call) {
        const result = await runAction(call, 'project.propose', {
            name: flags.name,
            reason: flags.reason,
            folder: flags.folder ?? null
        });
        return [`proposal\t${result.proposalId}\t${result.outcome}`];
    }
});

const ignoredAction = defineActionVerb('project', {
    name: 'ignored',
    action: 'project.ignoredFiles',
    usage: '',
    params: [],
    detail: [
        'prints\tfile\tpath\tbytes\tone line per file git ignores, relative to the root line',
        'prints\tlink\tpath\ta symbolic link git ignores, which a copy elsewhere would not keep',
        'leaves out\tA folder ignored whole, such as node_modules or dist, since it is built or installed rather than written',
        'why\tThese are the files a clone on another machine does not bring, such as .env files; copying them there is for a person, from the app',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'project ignored takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const { root, files, truncated } = await runAction(call, 'project.ignoredFiles', {});
        return [
            `root\t${field(root)}`,
            ...orNote(
                files.map((file) => (file.link ? `link\t${field(file.path)}` : `file\t${field(file.path)}\t${file.size}`)),
                'git ignores no file here outside folders it ignores whole'
            ),
            ...(truncated ? ['note\tthe list is cut; more files are ignored than one answer lists'] : [])
        ];
    }
});

const listAction = defineAction('project', {
    name: 'list',
    usage: '',
    summary: 'Lists the other projects open on this machine that --project reaches, while a person lets agents reach them',
    detail: [
        'prints\tproject\tid\ttitle\tone line per project open on this machine, including those in the background; your own and Chats are left out',
        'empty\tNothing while the machine keeps agents in their own project; a person turns reaching on under Agents in the settings',
        `crosses\t--project <id> goes with ${CROSSING_VERBS.join(', ')}; every other verb refuses it with cross-project-refused`,
        'read\tread <id> --project P reads every view, node and text of P without a line, other chats and terminals included',
        'agent\tagent and team --project P open their agents on a canvas of P that --view names, where a person there sees them; --cwd and --worktree stay inside P',
        'closed\tSwitching away keeps a project reachable; closing it into Recent takes it out of reach, ends its agents and fails their tasks',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'project list takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        return reachableLines(await reachableProjects(call.host, call.host.projects.locate(call.caller)?.projectId ?? null));
    }
});

export const PROJECT_SUMMARY =
    'Lists the other open projects agents may reach, suggests in a card of your chat in Chats that the chat becomes a project, and lists the files git ignores in the project, the ones a clone elsewhere does not bring';

export const PROJECT_DETAIL: readonly string[] = [
    'note\tOnly an AI chat in Chats suggests; the card shows in that chat until the person reviews it or declines',
    'note\tNothing is made by suggesting: the person picks the folder in the dialog that moves a chat into a project',
    SCOPE_LINE
];

export const PROJECT_ACTIONS = [listAction, proposeAction, ignoredAction] as const;
