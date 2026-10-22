import { MAX_PER_CALL } from '@ruimte/actions';
import { z } from 'zod';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { ONE_WRITE, jsonBatch } from './batch.ts';
import { unescapeText } from './text-escapes.ts';
import { VerbRefusal, placeOf } from './verb.ts';

const NEEDS_TEXT = '--text needs the body to write, in quotes';

const NEEDS_ID = 'node edit needs the id of a note';

const APPEND_FLAG = 'append';

const EDIT_USAGE = `(<nodeId> --text B [--${APPEND_FLAG}] | --json J) [--view V]`;

const EDIT_USAGE_LINES = [`usage\tnode edit\t${EDIT_USAGE}`, 'detail\truimte-context help node edit'];

/* One note of a --json call: its id and the body, with JSON's own escapes rather than the ones of --text. */
const JsonEditSchema = z.strictObject({
    id: z.string({ error: 'id needs the id of a note' }).min(1, 'id needs the id of a note'),
    text: z.string({ error: 'text needs the body to write' }),
    append: z.boolean({ error: 'append is true or false' }).optional()
});

const JSON_EXAMPLE = `ruimte-context node edit --json '[{"id":"note-1","text":"Done"},{"id":"note-2","text":"One more line","append":true}]'`;

export const nodeEditAction = defineActionVerb('node', {
    name: 'edit',
    action: 'node.update',
    usage: EDIT_USAGE,
    params: [
        { syntax: '<nodeId>', need: 'required', field: 'nodeId', text: 'The note to write in, by id' },
        {
            syntax: '--text B',
            need: 'required',
            field: 'text',
            more: '\\n, \\t and \\\\ are read as escapes, and --text - takes it from stdin, byte for byte'
        },
        { syntax: `--${APPEND_FLAG}`, need: 'no value', field: 'append' },
        {
            syntax: '--json J',
            need: 'in place of <nodeId> and --text',
            text: `Several notes in one call: an array of up to ${MAX_PER_CALL} objects, each with id, text and, to write under what is there, append set to true`,
            more: '--json - takes the array from stdin, a heredoc included'
        },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas the notes are on, by view id', more: 'ruimte-context view list lists them' }
    ],
    detail: [
        'prints\tedited\tid\tlines\tcharacters\tthe note as it now stands, so an append tells you how much is written there in total; one row per note, in the order given',
        `many\tTo write in several notes, give them all to one call with --json instead of calling once per note: ${ONE_WRITE}`,
        'many\tEach note is checked the way a single call checks it and written in the order given, and a refusal names the note',
        `example\t${JSON_EXAMPLE}`,
        "kind\tOnly a note: a file node is the file system's, and a browser, a terminal and a chat show what they run, not text of yours",
        'who\tA note you made yourself, or one a line joins you to, whichever way that line runs: a person drawing that line is what says you may write here',
        'who\tThe same line lets you read the note back with ruimte-context read, whichever way it runs',
        'who\tA chat view has no lines: it writes in any note of the canvas it names with --view, the way the person arranging that canvas would',
        'append\tThe text lands on a line of its own under what is there, so two agents writing in turn never drop what the other put down',
        'append\tEach call reads the note in the moment it writes it, so an append that crosses another keeps both lines',
        'note\tThe body it already carries writes nothing and is not a refusal',
        'note\tWithout --append the old body is gone; on a note you share with another agent that is what --append is for',
        'refusals\tnot-a-note\tnot-linked\tunknown-node\tnot-on-a-canvas\tthe whole set this action refuses with',
        'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
        'see\truimte-context node new note --text B\tadding the note in the first place',
        'see\truimte-context link new --to <id>\tthe line that makes a note somebody else made yours to write in'
    ],
    positionals: z.tuple([z.string().min(1, NEEDS_ID).optional()], {
        error: (issue) =>
            issue.code === 'too_big' ? 'node edit takes one node id and nothing else; the body goes in --text, and several notes go in --json' : NEEDS_ID
    }),
    switches: [APPEND_FLAG],
    flags: z.object({
        text: z.string({ error: NEEDS_TEXT }).transform(unescapeText).optional(),
        json: z.string().min(1, '--json needs an array of notes').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ positionals: [id], flags, switches }, call) {
        const append = switches.has(APPEND_FLAG);
        if (flags.json !== undefined) {
            const single = [
                ...(id === undefined ? [] : ['the node id']),
                ...(flags.text === undefined ? [] : ['--text']),
                ...(append ? [`--${APPEND_FLAG}`] : [])
            ];
            if (single.length > 0) {
                throw new VerbRefusal('bad-arguments', `--json carries every note with its own fields; leave out ${single.join(', ')}`, EDIT_USAGE_LINES);
            }
            const edits = jsonBatch(flags.json, JsonEditSchema, JSON_EXAMPLE);
            const viewId = await canvasIdFor(call, placeOf(call), flags.view);
            const edited = await runAction(call, 'node.updateMany', {
                viewId,
                nodes: edits.map((edit) => ({ nodeId: edit.id, text: edit.text, append: edit.append ?? false }))
            });
            return edited.nodes.map((node) => `edited\t${node.nodeId}\t${node.lines}\t${node.characters}`);
        }
        if (id === undefined) {
            throw new VerbRefusal('bad-arguments', NEEDS_ID, EDIT_USAGE_LINES);
        }
        if (flags.text === undefined) {
            throw new VerbRefusal('bad-arguments', NEEDS_TEXT, EDIT_USAGE_LINES);
        }
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const edited = await runAction(call, 'node.update', { viewId, nodeId: id, text: flags.text, append });
        return [`edited\t${id}\t${edited.lines}\t${edited.characters}`];
    }
});
