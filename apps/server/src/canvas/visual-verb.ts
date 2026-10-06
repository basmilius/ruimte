import { VISUAL_LAYOUT_GUIDE, VISUAL_LIMITS, VISUAL_PAGE_RULES, VISUAL_THEME_GUIDE } from '@ruimte/contracts';
import { z } from 'zod';
import { visualRow, visualRows } from '../actions/visual-actions.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { SCOPE_LINE, field } from './verb.ts';

/* A model that is not told so describes the page in its reply as well, which the person then reads twice. */
export const SHOWN_LINE =
    'shown\tThe person sees this page above your reply. Do not mention or describe it there: your reply adds only what the page does not say';

/* Each row one line of the shell command, so the heredoc reads the way it is typed. */
const EXAMPLE_LINES: readonly string[] = [
    `example\truimte-context visual show --title "Open issues per label" --height 160 <<'EOF'`,
    'example\t<!doctype html>',
    'example\t<div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px 12px;align-items:center">',
    'example\t<span>Bugs</span><div style="height:16px;width:80%;background:var(--chart-1);border-radius:var(--radius)"></div><span>32</span>',
    'example\t<span>Features</span><div style="height:16px;width:45%;background:var(--chart-2);border-radius:var(--radius)"></div><span>18</span>',
    'example\t</div>',
    'example\tEOF'
];

const show = defineActionVerb('visual', {
    name: 'show',
    action: 'visual.show',
    usage: '--title T [--height H] (< page.html | --html H)',
    params: [
        { syntax: '--title T', need: 'required', field: 'title', more: `at most ${VISUAL_LIMITS.title} characters` },
        {
            syntax: '--height H',
            need: 'optional',
            field: 'maxHeight',
            more: `a whole number from ${VISUAL_LIMITS.minHeight} to ${VISUAL_LIMITS.maxHeight}`
        },
        {
            syntax: '--html H',
            need: 'optional',
            field: 'html',
            more: 'given as one argument instead of on stdin; the CLI puts stdin here when you give no --html'
        }
    ],
    detail: [
        "stdin\tThe page, piped in or as a heredoc: ruimte-context visual show --title T <<'EOF' ... EOF; ruimte-context help visual has a whole example",
        'prints\tvisual\tid\ttitle\tsize\tthe visual shown, with the size of the stored page in bytes',
        SHOWN_LINE,
        'refusals\tvisual-needs-chat\tvisuals-off\tvisual-invalid\tvisual-too-large\tthe codes this action refuses with; the message of each says what to do instead'
    ],
    positionals: z.tuple([], { error: 'visual show takes no arguments; the page goes on stdin and its title in --title' }),
    flags: z.object({
        title: z.string({ error: 'visual show needs --title, a few words that say what the page shows' }),
        height: z
            .string()
            .regex(/^\d+$/, '--height takes a whole number of CSS pixels')
            .transform(Number)
            .refine(
                (value) => value >= VISUAL_LIMITS.minHeight && value <= VISUAL_LIMITS.maxHeight,
                `--height is from ${VISUAL_LIMITS.minHeight} to ${VISUAL_LIMITS.maxHeight} CSS pixels`
            )
            .optional(),
        html: z.string().optional()
    }),
    async run({ flags }, call) {
        const { visual } = await runAction(call, 'visual.show', { title: flags.title, html: flags.html ?? '', maxHeight: flags.height ?? null });
        return [visualRow(visual), SHOWN_LINE];
    }
});

const list = defineActionVerb('visual', {
    name: 'list',
    action: 'visual.list',
    usage: '',
    params: [],
    detail: ['prints\tvisual\tid\ttitle\tsize\tone line per visual of this chat, in the order they were shown; a note when there is none'],
    positionals: z.tuple([], { error: 'visual list takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const { visuals } = await runAction(call, 'visual.list', {});
        return visualRows(visuals);
    }
});

const remove = defineActionVerb('visual', {
    name: 'remove',
    action: 'visual.remove',
    usage: '<visualId>',
    params: [{ syntax: '<visualId>', need: 'required', field: 'visualId' }],
    detail: [
        'prints\tremoved\tid\ttitle\tthe visual is gone from the thread of every client',
        'refusals\tvisual-needs-chat\tvisual-not-found\tthe codes this action refuses with'
    ],
    positionals: z.tuple([z.string().min(1, 'visual remove needs the id of a visual; ruimte-context visual list lists them')], {
        error: (issue) =>
            issue.code === 'too_big'
                ? 'visual remove takes one id and nothing else'
                : 'visual remove needs the id of a visual; ruimte-context visual list lists them'
    }),
    flags: z.object({}),
    async run({ positionals: [visualId] }, call) {
        const removed = await runAction(call, 'visual.remove', { visualId });
        return [`removed\t${removed.visualId}\t${field(removed.title)}`];
    }
});

export const VISUAL_ACTIONS = [show, list, remove] as const;

export const VISUAL_SUMMARY = 'Shows a self-contained HTML page above your reply in this chat, and lists and removes the ones it shows';

export const VISUAL_DETAIL: readonly string[] = [
    'when\tA chart, a table, a diagram, a collage of images or a mockup that says more than prose; never for what a sentence or a short list says',
    `page\t${VISUAL_PAGE_RULES}`,
    `layout\t${VISUAL_LAYOUT_GUIDE}`,
    `theme\t${VISUAL_THEME_GUIDE}`,
    ...EXAMPLE_LINES,
    'reply\tThe page shows above your reply, so the reply adds only what the page does not say and never describes it',
    'chat\tOnly an AI chat shows one, in any permission mode: it changes nothing but your own thread. A person can remove one, and can turn visual replies off for this machine',
    SCOPE_LINE
];
