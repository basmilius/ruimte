import { z } from 'zod';
import { defineStandaloneActionVerb, runAction } from './action-verb.ts';
import { DEPTH_LIMIT_LINES } from './depth.ts';
import { MODE_LINES } from './mode.ts';
import { MAX_TITLE_LENGTH, titleField, oneArgument } from './verb.ts';

const NEEDS_ID = 'fork takes the id of the chat to fork, one you opened yourself';

export const forkVerb = defineStandaloneActionVerb({
    name: 'fork',
    action: 'chat.fork',
    usage: '<id> [--title T] [--branch B]',
    params: [
        { syntax: '<id>', need: 'required', field: 'chatId' },
        {
            syntax: '--title T',
            need: 'optional',
            field: 'title',
            text: `The title of the fork, at most ${MAX_TITLE_LENGTH} characters; without one the original's with (fork)`
        },
        { syntax: '--branch B', need: 'optional', field: 'branch' }
    ],
    detail: [
        'prints\tfork\tid\tview\tbranch\tthe new chat, the view it stands in or its own id for one that is a view or hidden, and its worktree branch or -',
        'prints\tnext\tthe last line, saying how to give it work',
        'who\tOnly a chat you opened yourself with agent or team, which the machine wrote down outside the project; a line into a node, or a chat a person attached, is not enough',
        'yours\tThe fork is an agent you opened: you read it, answer it, give it tasks and remove it the way you do the one you forked, and stopping you ends it too',
        'where\tBeside the original with a line from it, or a hidden agent of yours when the original is hidden',
        'conversation\tIt goes on after the last turn of the original that finished, with the conversation up to it, in the same CLI, account and model',
        'files\tWithout --branch it works in the folder of the original; with --branch in a new worktree on that branch, from HEAD',
        'turn\tNot while the original works on a turn: its conversation would change while it is copied',
        'task\tA fork starts no turn: give it work with task_new <id>, whose result wakes you once, like that of any agent you opened',
        ...MODE_LINES,
        ...DEPTH_LIMIT_LINES,
        'refusals\tself-fork\tnot-yours\tnode-on-other-machine\tnot-a-chat\tno-turn\tturn-running\tchat-busy\ttranscript-missing\ttoo-deep\ttoo-many-agents\tnot-a-repository\tbranch-exists\tthe codes this verb refuses with most',
        'ids\tOnly ids, never titles: the id is the one agent or team printed when it opened the chat'
    ],
    positionals: oneArgument(NEEDS_ID, 'fork takes one id and nothing else'),
    flags: z.object({
        title: titleField('--title', '--title needs the title of the fork').optional(),
        branch: z.string().trim().min(1, '--branch needs the name of a new branch').optional()
    }),
    async run({ positionals: [id], flags }, call) {
        const forked = await runAction(call, 'chat.fork', {
            chatId: id,
            turnId: null,
            title: flags.title ?? null,
            branch: flags.branch ?? null
        });
        return [
            `fork\t${forked.nodeId}\t${forked.viewId}\t${forked.branch ?? '-'}`,
            `next\tGive it work with task_new ${forked.nodeId} --prompt T; its result wakes you once it settled`
        ];
    }
});
