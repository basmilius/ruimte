import { VISUAL_LAYOUT_GUIDE, VISUAL_LIMITS, VISUAL_PAGE_RULES, VISUAL_THEME_GUIDE } from '@ruimte/contracts';
import { z } from 'zod';
import { visualRow, visualRows } from '../actions/visual-actions.ts';
import { CONSOLE_LIMITS } from '../visuals/page-console.ts';
import { SHOT_MAX_HEIGHT } from '../visuals/render-protocol.ts';
import { PREVIEW_LIMIT_MS, PREVIEW_WIDTH } from '../visuals/renderer.ts';
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

const NEXT_LINE = 'next\tThis only checked the page; ruimte-context visual show --title T with the same page on stdin shows it above your reply';

const preview = defineActionVerb('visual', {
    name: 'preview',
    action: 'visual.preview',
    usage: '[--width W] [--appearance dark|light] (< page.html | --html H)',
    params: [
        {
            syntax: '--width W',
            need: 'optional',
            field: 'width',
            more: `a whole number from ${PREVIEW_WIDTH.min} to ${PREVIEW_WIDTH.max}; that column is ${PREVIEW_WIDTH.default}`
        },
        { syntax: '--appearance A', need: 'optional', field: 'appearance', more: 'dark or light' },
        {
            syntax: '--html H',
            need: 'optional',
            field: 'html',
            more: 'given as one argument instead of on stdin; the CLI puts stdin here when you give no --html'
        }
    ],
    detail: [
        'stdin\tThe page, the same way visual show takes it',
        'prints\tshot\tpath\tthe png on this machine, which you open with your own tools',
        'prints\theight\tpixels\tthe height the page needs at that width; the frame in the chat takes it',
        `prints\tconsole\tlevel\ttext\twhat the page wrote to its console, uncaught exceptions with their stack and what failed to load, at most ${CONSOLE_LIMITS.messages}; a note when there is nothing`,
        `browser\tA headless Chrome on this machine draws the page as the chat would. It loads public http(s) addresses as the chat does and never this machine or its network; a page that does not settle within ${PREVIEW_LIMIT_MS / 1000} s is refused`,
        'refusals\tvisual-needs-chat\tvisuals-off\tvisual-invalid\tvisual-too-large\tpreview-unavailable\tpreview-timeout\tpreview-failed\tthe codes this action refuses with; on preview-unavailable show the page without a preview'
    ],
    positionals: z.tuple([], { error: 'visual preview takes no arguments; the page goes on stdin' }),
    flags: z.object({
        width: z
            .string()
            .regex(/^\d+$/, '--width takes a whole number of CSS pixels')
            .transform(Number)
            .refine(
                (value) => value >= PREVIEW_WIDTH.min && value <= PREVIEW_WIDTH.max,
                `--width is from ${PREVIEW_WIDTH.min} to ${PREVIEW_WIDTH.max} CSS pixels`
            )
            .optional(),
        appearance: z.enum(['dark', 'light'], { error: '--appearance is dark or light' }).optional(),
        html: z.string().optional()
    }),
    async run({ flags }, call) {
        const shown = await runAction(call, 'visual.preview', { html: flags.html ?? '', width: flags.width ?? null, appearance: flags.appearance ?? null });
        return [
            `shot\t${field(shown.path)}\tthe png on this machine, which you open with your own tools`,
            `height\t${shown.height}\tthe height the page needs at ${shown.width}px`,
            ...(shown.shotHeight < shown.height ? [`note\tThe shot covers the first ${shown.shotHeight} of those pixels`] : []),
            ...(shown.console.length === 0
                ? ['note\tThe page wrote nothing to its console']
                : shown.console.map((entry) => `console\t${entry.level}\t${field(entry.text)}`)),
            ...(shown.omitted > 0 ? [`note\t${shown.omitted} more console messages were left out`] : []),
            NEXT_LINE
        ];
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

export const VISUAL_ACTIONS = [preview, show, list, remove] as const;

export const VISUAL_SUMMARY = 'Previews a self-contained HTML page, shows it above your reply in this chat, and lists and removes the ones it shows';

export const VISUAL_DETAIL: readonly string[] = [
    'when\tA chart, a table, a diagram, a collage of images or a mockup that says more than prose; never for what a sentence or a short list says',
    `page\t${VISUAL_PAGE_RULES}`,
    `layout\t${VISUAL_LAYOUT_GUIDE}`,
    `theme\t${VISUAL_THEME_GUIDE}`,
    ...EXAMPLE_LINES,
    `preview\tPreview first, then show: ruimte-context visual preview < page.html draws the page in a browser on this machine and prints a png of it, the height it takes and its console, so you fix what is off before the person sees it. Previews are ${PREVIEW_WIDTH.default}px wide and dark unless --width and --appearance say otherwise; the png covers at most ${SHOT_MAX_HEIGHT}px`,
    'reply\tThe page shows above your reply, so the reply adds only what the page does not say and never describes it',
    'chat\tOnly an AI chat shows one, in any permission mode: it changes nothing but your own thread. A person can remove one, and can turn visual replies off for this machine',
    SCOPE_LINE
];
