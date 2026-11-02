import { DRAWING_COLORS } from '@ruimte/contracts';
import { DRAWING_EDIT_LIMITS, DrawingElementPatchSchema, NewDrawingElementSchema } from '@adecore/drawing';
import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { typeOf } from './diagram-verb.ts';
import { DRY_RUN_PREVIEW, VerbRefusal, oneArgument } from './verb.ts';

/* An edit that passes, so an agent has one shape to start from; a test holds it to the schema. */
const DRAWING_EDIT_EXAMPLE = JSON.stringify({
    add: [
        { kind: 'ellipse', x: 620, y: 40, w: 90, h: 90, stroke: 'orange', strokeWidth: 2, fill: 'solid', fillColor: 'yellow' },
        {
            kind: 'line',
            x: 600,
            y: 85,
            w: 16,
            h: 0,
            points: [
                [0, 0],
                [16, 0]
            ],
            stroke: 'orange',
            strokeWidth: 2
        },
        { kind: 'text', x: 600, y: 150, w: 120, h: 30, text: 'Sun', size: 20 }
    ],
    update: [{ id: 'el-31', stroke: 'blue' }],
    remove: ['el-07']
});

/* Every kind with the fields it takes, read off the schema, so a field added in the package shows up here without an edit. */
function kindLines(): string[] {
    return NewDrawingElementSchema.options.map((option) => {
        const shape = option.shape as Record<string, z.ZodType>;
        const fields = Object.entries(shape)
            .filter(([key]) => key !== 'kind')
            .map(([key, schema]) => `${key}${schema instanceof z.ZodOptional ? '?' : ''}: ${typeOf(schema)}`);
        return `kind\t${option.shape.kind.value}\t${fields.join(', ')}`;
    });
}

const DETAIL: readonly string[] = [
    "stdin\tThe edit as JSON, piped in or as a heredoc: view_drawing <viewId> --revision N <<'EOF' ... EOF",
    'prints\tview\trev\telements\tthe view written, its new revision and how many elements it now holds, then one added line per new element with its id, in the order of add',
    'edit\t{ add, update, remove }\tone JSON object; each list is optional, and the whole edit is one step: everything lands or nothing does',
    'add\tNew elements, drawn on top in the order given. The daemon gives each its id and seed; stroke is ink, strokeWidth 2 and a text or note size 20 when left out',
    ...kindLines(),
    `update\t{ id, ...fields }\tthe fields that change on that element; its kind stays, and a field its kind does not have is refused: ${Object.keys(DrawingElementPatchSchema.shape).join(', ')}`,
    'remove\t[id]\tthe ids of the elements to take away',
    `colors\t${DRAWING_COLORS.join('|')}\tpalette names, never a hex color, so the drawing follows the theme`,
    'coordinates\tx and y are the top left corner of the box in drawing units, w and h its size; the points of a line or a freehand stroke are relative to x and y and lie inside the box. read <viewId> --elements prints every box',
    'revision\tThe revision read <viewId> --elements printed. A person may draw in the same drawing meanwhile: only an update or a remove of an element that changed after that revision is refused with rev-conflict, which names those elements; read again and decide anew',
    'undo\tA person takes back a whole call with one undo, so make a whole change in one call rather than one element at a time',
    'locked\tAn element a person locked is never updated or removed, and an edit cannot lock one',
    'strict\tA field that is not listed here is refused by its path, never dropped',
    `limits\tAt most ${DRAWING_EDIT_LIMITS.perEdit} elements added, updated and removed per call, and ${DRAWING_EDIT_LIMITS.elements} in the whole drawing after it`,
    'who\tA drawing the person pointed you at with # in one of your messages, one a line joins you to, or one you made yourself with view new --kind drawing; a # to the canvas a drawing node stands on is not enough',
    'refusals\tnot-a-drawing\tnot-linked\tno-edit\tbad-json\tbad-edit\trev-conflict\tdrawing-invalid\tthe codes this verb refuses with',
    `example\t${DRAWING_EDIT_EXAMPLE}`
];

export const drawingAction = defineActionVerb('view', {
    name: 'drawing',
    action: 'drawing.edit',
    usage: '<viewId> --revision N [--dry-run] < edit.json',
    params: [
        {
            syntax: '<viewId>',
            need: 'required',
            field: 'viewId',
            more: 'view_list lists them, view_new <name> --kind drawing makes one'
        },
        { syntax: '--revision N', need: 'required', field: 'revision' },
        {
            syntax: '--edit JSON',
            need: 'optional',
            field: 'edit',
            text: 'The edit as one argument instead of on stdin; the CLI puts stdin here when you leave it out'
        },
        { syntax: '--dry-run', need: 'no value', text: `Checks everything and writes nothing; ${DRY_RUN_PREVIEW}` }
    ],
    detail: DETAIL,
    dryRun: true,
    positionals: oneArgument('view drawing needs the id of a drawing view', 'view drawing takes one view id and nothing else; the edit goes on stdin'),
    // The registry takes --revision off every verb as the project's; here it is the drawing's, so it is listed only to be accepted.
    flags: z.object({ revision: z.string().optional(), edit: z.string().optional() }),
    async run({ positionals: [viewId], flags, dryRun }, call) {
        const { expectedRevision: revision, ...unheld } = call;
        if (revision === undefined) {
            throw new VerbRefusal('bad-arguments', 'view drawing needs --revision with the revision read <viewId> --elements printed', [
                'usage\tview drawing\t<viewId> --revision N < edit.json'
            ]);
        }
        const edited = await runAction(unheld, 'drawing.edit', { viewId, revision, edit: flags.edit ?? '' }, dryRun);
        return [[edited.viewId, edited.rev, edited.elements].join('\t'), ...edited.added.map((id) => `added\t${id}`)];
    }
});
