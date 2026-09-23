import { z } from 'zod';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { unescapeText } from './text-escapes.ts';
import { placeOf } from './verb.ts';

const NEEDS_TEXT = '--text needs the body to write, in quotes';

const APPEND_FLAG = 'append';

export const nodeEditAction = defineActionVerb('node', {
    name: 'edit',
    action: 'node.update',
    usage: `<nodeId> --text B [--${APPEND_FLAG}] [--view V]`,
    params: [
        { syntax: '<nodeId>', need: 'required', field: 'nodeId', text: 'The note to write in, by id; one note per call' },
        {
            syntax: '--text B',
            need: 'required',
            field: 'text',
            more: '\\n, \\t and \\\\ are read as escapes, and --text - takes it from stdin, byte for byte'
        },
        { syntax: `--${APPEND_FLAG}`, need: 'no value', field: 'append' },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas the note is on, by view id', more: 'ruimte-context view list lists them' }
    ],
    detail: [
        'prints\tedited\tid\tlines\tcharacters\tthe note as it now stands, so an append tells you how much is written there in total',
        "kind\tOnly a note: a file node is the file system's, and a browser, a terminal and a chat show what they run, not text of yours",
        'who\tA note you made yourself, or one a line joins you to, whichever way that line runs: a person drawing that line is what says you may write here',
        'who\tThe same line lets you read the note back with ruimte-context read, whichever way it runs',
        'append\tThe text lands on a line of its own under what is there, so two agents writing in turn never drop what the other put down',
        'append\tEach call reads the note in the moment it writes it, so an append that crosses another keeps both lines',
        'note\tThe body it already carries writes nothing and is not a refusal',
        'note\tWithout --append the old body is gone; on a note you share with another agent that is what --append is for',
        'refusals\tnot-a-note\tnot-linked\tunknown-node\tnot-on-a-canvas\tthe whole set this action refuses with',
        'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
        'see\truimte-context node new note --text B\tadding the note in the first place',
        'see\truimte-context link new --to <id>\tthe line that makes a note somebody else made yours to write in'
    ],
    positionals: z.tuple([z.string().min(1, 'node edit needs the id of a note')], {
        error: (issue) =>
            issue.code === 'too_big' ? 'node edit takes one node id and nothing else; the body goes in --text' : 'node edit needs the id of a note'
    }),
    switches: [APPEND_FLAG],
    flags: z.object({
        text: z.string({ error: NEEDS_TEXT }).transform(unescapeText),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ positionals: [id], flags, switches }, call) {
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const edited = await runAction(call, 'node.update', { viewId, nodeId: id, text: flags.text, append: switches.has(APPEND_FLAG) });
        return [`edited\t${id}\t${edited.lines}\t${edited.characters}`];
    }
});
