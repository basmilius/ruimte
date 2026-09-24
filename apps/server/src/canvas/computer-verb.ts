import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { APPROVAL_WAIT_MS } from '../computer/approvals.ts';
import { READ_MAX_CHARS } from '../actions/computer-actions.ts';
import { defineActionVerb, runAction, type ActionParam } from './action-verb.ts';
import { VerbRefusal, field } from './verb.ts';

type ComputerState = ActionOutput<'computer.state'>;
type ComputerOutcome = ActionOutput<'computer.click'>;

const APP_PARAM = { syntax: '<app>', need: 'required', field: 'app', more: 'a name with spaces in it is one argument' } as const;

/* The flags every action takes to answer with a fresh state, and `state` takes to cut its own. */
const CUT_PARAMS = [
    { syntax: '--no-screenshot', need: 'no value', text: 'Leaves the picture of the window out' },
    { syntax: '--max-depth N', need: 'optional', field: 'maxDepth' },
    { syntax: '--max-elements N', need: 'optional', field: 'maxElements' },
    { syntax: '--max-text N', need: 'optional', field: 'maxText' }
] as const;

const WAIT_PARAM = {
    syntax: '--wait S',
    need: 'optional',
    field: 'wait',
    more: 'give your shell command a timeout above it, since some CLIs end one after 10 s'
} as const;

const STATE_PARAM = {
    syntax: '--state',
    need: 'no value',
    field: 'withState',
    more: 'the answer then ends in the state lines: only what changed, marked + new, - gone, ~ changed; --state=full for the whole tree'
} as const;

const wholeFlag = (flag: string, min: number, max: number) =>
    z
        .string()
        .regex(/^\d+$/, `--${flag} takes a whole number`)
        .transform(Number)
        .refine((value) => value >= min && value <= max, `--${flag} is between ${min} and ${max}`)
        .optional();

const pixelFlag = (flag: string) =>
    z
        .string()
        .regex(/^\d+(\.\d+)?$/, `--${flag} takes a pixel of the last screenshot, a number of 0 or more`)
        .transform(Number)
        .optional();

/* The flags of every call that reads or operates an app: how long it holds for the person, and how its state is cut. */
const CUT_FLAGS = {
    wait: wholeFlag('wait', 1, 110),
    'max-depth': wholeFlag('max-depth', 1, 200),
    'max-elements': wholeFlag('max-elements', 1, 5000),
    'max-text': wholeFlag('max-text', 10, 10_000)
};

interface CutInput {
    flags: { wait?: number; 'max-depth'?: number; 'max-elements'?: number; 'max-text'?: number };
    switches: ReadonlySet<string>;
}

const cutOf = ({ flags, switches }: CutInput) => ({
    wait: flags.wait ?? null,
    screenshot: !switches.has('no-screenshot'),
    maxDepth: flags['max-depth'] ?? null,
    maxElements: flags['max-elements'] ?? null,
    maxText: flags['max-text'] ?? null
});

/* An action's flags: those of every call, and --state, which may ask for the whole tree. */
const ACTION_FLAGS = {
    state: z.enum(['full'], { error: '--state takes no value, or =full for the whole tree' }).optional(),
    ...CUT_FLAGS
};

const ACTION_SWITCHES = ['state', 'no-screenshot'] as const;

/* The same for an action, which answers with the state after it only when --state asks. */
const thenState = (input: CutInput & { flags: { state?: 'full' } }) => ({
    withState: input.switches.has('state'),
    fullState: input.flags.state === 'full',
    ...cutOf(input)
});

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const round = (value: number): string => String(Math.round(value * 100) / 100);

const windowLines = (state: ComputerState): string[] => [
    `window\t${field(state.window.title)}\t${round(state.window.x)},${round(state.window.y)}\t${round(state.window.width)}x${round(state.window.height)}`,
    ...(state.window.sheet === null ? [] : [`sheet\t${field(state.window.sheet)}`]),
    state.screenshot === null
        ? `shot\tnone\t${field(state.screenshotError ?? '')}`
        : `shot\t${field(state.screenshot.path)}\t${state.screenshot.width}x${state.screenshot.height}\t${round(state.screenshot.scale)}\t${round(state.screenshot.originX)},${round(state.screenshot.originY)}`
];

const remarkLines = (state: ComputerState): string[] => [
    ...(state.truncated === null ? [] : [`truncated\t${field(state.truncated)}`]),
    ...(state.hidden ? ['hidden\tyes\tIts windows are off screen; computer open shows it'] : []),
    ...(state.note === null ? [] : [`note\t${field(state.note)}`])
];

const changeCounts = ({ added, gone, changed }: { added: number; gone: number; changed: number }): string =>
    added + gone + changed === 0 ? 'none' : `${added} new\t${gone} gone\t${changed} changed`;

/*
 * A window, its picture and its tree: one row each, the tree a row per element with its indent kept.
 * After an action that is only what changed, since the rest is what the agent read before.
 */
export const stateLines = (state: ComputerState): string[] => {
    const tree = state.tree.map((line) => `tree\t${field(line)}`);
    if (state.diff !== null && state.diff !== undefined) {
        return [...windowLines(state), ...remarkLines(state), `changes\t${changeCounts(state.diff)}`, ...tree];
    }
    return [
        `app\t${field(state.app.name)}\t${state.app.bundleId ?? '-'}\t${state.app.pid}`,
        ...windowLines(state),
        `elements\t${state.elements}`,
        ...(state.matches === null || state.matches === undefined ? [] : [`matches\t${state.matches}`]),
        ...(state.within === null || state.within === undefined ? [] : [`within\t${state.within}`]),
        ...remarkLines(state),
        ...(state.full === null || state.full === undefined ? [] : [`full\t${field(state.full)}`]),
        ...tree
    ];
};

/* What an action did, and the state after it when it was asked for. */
export const outcomeLines = (word: string, outcome: ComputerOutcome): string[] => {
    const { target } = outcome;
    return [
        `done\t${word}\t${field(outcome.app?.name ?? '-')}`,
        ...(target === null
            ? []
            : [`target\t${field(target.role ?? '-')}\t${field(target.label ?? '-')}\t${field(target.identifier ?? '-')}\t${field(target.window ?? '-')}`]),
        ...(outcome.point === null ? [] : [`point\t${round(outcome.point.x)},${round(outcome.point.y)}`]),
        ...Object.entries(outcome.details).map(([key, value]) => `detail\t${field(key)}\t${field(value)}`),
        ...(outcome.note === null ? [] : [`note\t${field(outcome.note)}`]),
        ...(outcome.settled === null ? [] : [`settled\t${yesNo(outcome.settled)}`]),
        ...(outcome.stateError === null ? [] : [`state\tnone\t${field(outcome.stateError)}`]),
        ...(outcome.state === null ? [] : stateLines(outcome.state))
    ];
};

const STATE_PRINTS: readonly string[] = [
    'prints\tapp\tname\tbundle id\tpid',
    'prints\twindow\ttitle\tx,y\twidthxheight\tthe key window in screen points, top-left origin of the main display',
    'prints\tsheet\tlabel\twhen a sheet is up; the tree and the picture show it over its window',
    'prints\tshot\tpath\twidthxheight\tscale\tx,y\tthe png on this machine, its pixels per point and the screen point of its top-left; shot none and why when there is no picture',
    'prints\ttree\tline\tone row per element: [N] role, label, value=, desc=, id=, frame, and focused, selected, disabled or offscreen; the indent after the tab is its depth',
    'prints\ttruncated, hidden, note\twhen the tree was cut, the app is hidden, or the helper has something to say',
    'read\t[N] is the number an action takes with --element; text longer than --max-text ends in …"(cut: N chars), which computer read shows whole'
];

const OUTCOME_PRINTS: readonly string[] = [
    'prints\tdone\taction\tapp',
    'prints\ttarget\trole\tlabel\tidentifier\twindow\twhat it acted on; for a click by pixel what was under it',
    'prints\tpoint\tx,y\twhere the pointer went, in screen points',
    'prints\tdetail\tkey\tvalue\twhat the helper reports of its own, such as method (AXPress or mouse), typed or pressed',
    'prints\tsettled\tyes|no\twith --state: whether the window stopped changing within 3 s; the state rows follow',
    'prints\tchanges\tN new\tN gone\tN changed\twith --state: the tree rows are only the lines that changed against the last tree you got for this app, or none',
    'prints\ttree\t+ line | - line | ~ line\ta new element, one that went, and the new form of one that changed; the window and shot rows are there as always',
    'prints\tfull\twhy\twhen the rows after an action are the whole tree after all: the first state of this app you got, a new window or a new sheet'
];

/* What holds for every action, said once per action so `help computer <action>` is whole. */
const COMMON_DETAIL: readonly string[] = [
    `approval\tThe first call in an app a person has not let you into puts a card in front of them and holds up to ${APPROVAL_WAIT_MS / 1000} s, or --wait S, for their answer`,
    'approval\tA yes holds for this chat or terminal session, or for always on this machine; a no reaches you once, as declined. Every permission mode asks, full-access included',
    `hold\tThe person can pause the session or take the Mac over with their own mouse; a call then holds up to ${APPROVAL_WAIT_MS / 1000} s, or --wait S, until they give it back. Never reach the app another way meanwhile`,
    'timeout\tWith --wait, give your shell command a timeout above it: some CLIs end a shell command after 10 s unless you ask for more',
    'refused\tawaiting-approval\tthe card is still up: tell the person, then call again with --wait 60',
    'refused\tpaused, taken-over\tthe person still holds the Mac: call computer state with --wait 60, since they may have changed the window, then act on what it shows',
    'refused\tdeclined\tthe person said no to this app: leave it alone unless they ask you to',
    'refused\tstopped\tthe person stopped you: ask them before you go on; once they agree, computer state picks up again',
    'refused\tterminal\tthe app runs shells and is never yours, whatever the person says: run the command in your own shell',
    'refused\tapp-refused\tthe app or the helper said no, usually to a number from an older state: read the state again',
    'refused\tnot-in-session, computer-use-off, not-granted\tnothing you can change: tell the person',
    'elements\tAn element keeps its number while it is the same element; after a new window or sheet read the state again',
    'see\truimte-context computer apps\tthe apps that run, and which of them you may operate without asking'
];

const apps = defineActionVerb('computer', {
    name: 'apps',
    action: 'computer.apps',
    usage: '',
    params: [],
    detail: [
        'prints\tapp\tname\tbundle id\tpid\taccess\tfront\taccess is always, this-time, ask (a card goes up on first use), terminal (refused) or no-bundle-id (refused); front is front, hidden or -',
        'prints\tnote\tsentence\twhen the helper has no Screen Recording, which a state picture and a click by pixel need',
        'note\tListing asks nobody: it reads no window and operates nothing'
    ],
    positionals: z.tuple([], { error: 'computer apps takes nothing' }),
    flags: z.object({}),
    async run(_input, call) {
        const listed = await runAction(call, 'computer.apps', {});
        return [
            ...listed.apps.map(
                (app) => `app\t${field(app.name)}\t${app.bundleId ?? '-'}\t${app.pid}\t${app.access}\t${app.frontmost ? 'front' : app.hidden ? 'hidden' : '-'}`
            ),
            ...(listed.screenRecording
                ? []
                : ['note\tRuimte Computer Use has no Screen Recording, so a state has no picture and a click by pixel is refused; only a person grants it'])
        ];
    }
});

const appTuple = (word: string) =>
    z.tuple([z.string().min(1, `computer ${word} needs an app`)], {
        error: (issue) =>
            issue.code === 'too_big' ? `computer ${word} takes one app; a name with spaces in it is one argument` : `computer ${word} needs an app`
    });

const state = defineActionVerb('computer', {
    name: 'state',
    action: 'computer.state',
    usage: '<app>',
    params: [
        APP_PARAM,
        { syntax: '--find T', need: 'optional', field: 'find', more: 'prints matches, the number of elements that hold it' },
        { syntax: '--within N', need: 'optional', field: 'within', more: 'the numbers stay the ones the elements had' },
        WAIT_PARAM,
        ...CUT_PARAMS
    ],
    detail: [
        ...STATE_PRINTS,
        'note\tA whole state is what the next --state after an action is told against; one with --find or --within is not',
        ...COMMON_DETAIL
    ],
    positionals: appTuple('state'),
    flags: z.object({ find: z.string().min(1, '--find needs the text to look for').optional(), within: wholeFlag('within', 0, 1_000_000), ...CUT_FLAGS }),
    switches: ['no-screenshot'],
    async run({ positionals: [app], flags, switches }, call) {
        const part = { find: flags.find ?? null, within: flags.within ?? null };
        return stateLines(await runAction(call, 'computer.state', { app, ...part, ...cutOf({ flags, switches }) }));
    }
});

const read = defineActionVerb('computer', {
    name: 'read',
    action: 'computer.read',
    usage: '<app> --element N',
    params: [APP_PARAM, { syntax: '--element N', need: 'required', field: 'element' }, WAIT_PARAM],
    detail: [
        'prints\telement\tN\trole',
        'prints\tframe\tx,y\twidthxheight\tin screen points',
        `prints\ttitle, value, description, placeholder, identifier\ttext\tone row per line of the text, whole up to ${READ_MAX_CHARS} characters`,
        'prints\tcut\tkey\tshown\ttotal\twhen a text was longer than that: its first characters are shown',
        'note\tFor a value a state cuts at 100 characters, such as the text of a document or a long label',
        ...COMMON_DETAIL
    ],
    positionals: appTuple('read'),
    flags: z.object({
        element: z.string({ error: 'computer read needs --element' }).regex(/^\d+$/, '--element takes a whole number').transform(Number),
        wait: CUT_FLAGS.wait
    }),
    async run({ positionals: [app], flags }, call) {
        const read = await runAction(call, 'computer.read', { app, element: flags.element, wait: flags.wait ?? null });
        const texts = [
            ['title', read.title],
            ['value', read.value],
            ['description', read.description],
            ['placeholder', read.placeholder],
            ['identifier', read.identifier]
        ] as const;
        return [
            `done\tread\t${field(read.app.name)}`,
            `element\t${read.element}\t${field(read.role)}`,
            ...(read.frame === null ? [] : [`frame\t${round(read.frame.x)},${round(read.frame.y)}\t${round(read.frame.width)}x${round(read.frame.height)}`]),
            ...texts.flatMap(([key, text]) => (text === null ? [] : text.split(/\r\n|\r|\n/).map((line) => `${key}\t${field(line)}`))),
            ...Object.entries(read.cut).map(([key, total]) => `cut\t${key}\t${READ_MAX_CHARS}\t${total}`)
        ];
    }
});

const wait = defineActionVerb('computer', {
    name: 'wait',
    action: 'computer.wait',
    usage: '<app> (--text T | --gone T | --element N --value V)',
    params: [
        APP_PARAM,
        { syntax: '--text T', need: 'or --gone', field: 'text' },
        { syntax: '--gone T', need: 'or --text', field: 'gone' },
        { syntax: '--element N', need: 'with --value', field: 'element' },
        { syntax: '--value V', need: 'with --element', field: 'value' },
        { syntax: '--timeout S', need: 'optional', field: 'timeout', more: 'at most 110; give your shell command a timeout above it' },
        WAIT_PARAM,
        { syntax: '--state', need: 'no value', field: 'fullState', more: 'write --state=full; without it the rows are only what changed' },
        ...CUT_PARAMS
    ],
    detail: [
        'prints\tdone\twait\tapp\twhat it waited for\tthe seconds it took',
        'prints\tstate rows\tonly what changed against the last tree you got, as after an action with --state',
        'note\tUse it instead of sleeping: after an action that starts something slow, wait for the text that says it is done',
        'timeout\tRefused with timeout when the time is up; the state under it is how the window stands then',
        ...COMMON_DETAIL
    ],
    positionals: appTuple('wait'),
    flags: z.object({
        text: z.string().min(1, '--text needs the text to wait for').optional(),
        gone: z.string().min(1, '--gone needs the text to wait for').optional(),
        element: wholeFlag('element', 0, 1_000_000),
        value: z.string().optional(),
        timeout: wholeFlag('timeout', 1, 110),
        ...ACTION_FLAGS
    }),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app], flags, switches }, call) {
        const outcome = await runAction(call, 'computer.wait', {
            app,
            text: flags.text ?? null,
            gone: flags.gone ?? null,
            element: flags.element ?? null,
            value: flags.value ?? null,
            timeout: flags.timeout ?? null,
            fullState: flags.state === 'full',
            ...cutOf({ flags, switches })
        });
        const lines = [
            ...(outcome.stateError === null ? [] : [`state\tnone\t${field(outcome.stateError)}`]),
            ...(outcome.state === null ? [] : stateLines(outcome.state))
        ];
        if (!outcome.met) {
            throw new VerbRefusal(
                'timeout',
                `Waited ${round(outcome.waited)} s for ${outcome.condition}, and it did not happen. The state below is how the window stands now; wait again with a longer --timeout, or act on what you see`,
                lines
            );
        }
        return [`done\twait\t${field(outcome.app.name)}\t${field(outcome.condition)}\t${round(outcome.waited)}`, ...lines];
    }
});

const ELEMENT_PARAM = { syntax: '--element N', need: 'or --x/--y', field: 'element' } as const;
const X_PARAM = { syntax: '--x PX', need: 'with --y', field: 'x' } as const;
const Y_PARAM = { syntax: '--y PX', need: 'with --x', field: 'y' } as const;

/* The params and flags of an action that answers with what it did and, with --state, the state after. */
const actionParams = <
    Name extends
        | 'computer.click'
        | 'computer.scroll'
        | 'computer.type'
        | 'computer.key'
        | 'computer.setValue'
        | 'computer.menu'
        | 'computer.open'
        | 'computer.drag'
>(
    own: readonly ActionParam<Name>[]
): ActionParam<Name>[] => [APP_PARAM, ...own, WAIT_PARAM, STATE_PARAM, ...CUT_PARAMS] as ActionParam<Name>[];

const click = defineActionVerb('computer', {
    name: 'click',
    action: 'computer.click',
    usage: '<app> (--element N | --x PX --y PX)',
    params: actionParams<'computer.click'>([
        ELEMENT_PARAM,
        X_PARAM,
        Y_PARAM,
        { syntax: '--count N', need: 'optional', field: 'count' },
        { syntax: '--button B', need: 'optional', field: 'button' }
    ]),
    detail: [
        'note\tBy element it presses the element without moving the pointer when the app lets it, and clicks its visible center otherwise; a click that would land on something else is refused',
        'note\tBy pixel it maps a pixel of the last screenshot to the screen and always uses the mouse',
        ...OUTCOME_PRINTS,
        ...COMMON_DETAIL
    ],
    positionals: appTuple('click'),
    flags: z.object({
        element: wholeFlag('element', 0, 1_000_000),
        x: pixelFlag('x'),
        y: pixelFlag('y'),
        count: wholeFlag('count', 1, 3),
        button: z.enum(['left', 'right'], { error: '--button is left or right' }).optional(),
        ...ACTION_FLAGS
    }),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app], flags, switches }, call) {
        const outcome = await runAction(call, 'computer.click', {
            app,
            element: flags.element ?? null,
            x: flags.x ?? null,
            y: flags.y ?? null,
            count: flags.count ?? null,
            button: flags.button ?? null,
            ...thenState({ flags, switches })
        });
        return outcomeLines('click', outcome);
    }
});

const scroll = defineActionVerb('computer', {
    name: 'scroll',
    action: 'computer.scroll',
    usage: '<app> (--element N | --x PX --y PX) --direction D',
    params: actionParams<'computer.scroll'>([
        ELEMENT_PARAM,
        X_PARAM,
        Y_PARAM,
        { syntax: '--direction D', need: 'required', field: 'direction', more: 'up, down, left or right' },
        { syntax: '--pages N', need: 'optional', field: 'pages' }
    ]),
    detail: [...OUTCOME_PRINTS, ...COMMON_DETAIL],
    positionals: appTuple('scroll'),
    flags: z.object({
        element: wholeFlag('element', 0, 1_000_000),
        x: pixelFlag('x'),
        y: pixelFlag('y'),
        direction: z.enum(['up', 'down', 'left', 'right'], { error: '--direction is up, down, left or right' }),
        pages: z
            .string()
            .regex(/^\d+(\.\d+)?$/, '--pages takes a number')
            .transform(Number)
            .refine((value) => value > 0 && value <= 50, '--pages is above 0 and at most 50')
            .optional(),
        ...ACTION_FLAGS
    }),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app], flags, switches }, call) {
        const outcome = await runAction(call, 'computer.scroll', {
            app,
            element: flags.element ?? null,
            x: flags.x ?? null,
            y: flags.y ?? null,
            direction: flags.direction,
            pages: flags.pages ?? null,
            ...thenState({ flags, switches })
        });
        return outcomeLines('scroll', outcome);
    }
});

const drag = defineActionVerb('computer', {
    name: 'drag',
    action: 'computer.drag',
    usage: '<app> (--from N | --from-x PX --from-y PX) (--to N | --to-x PX --to-y PX)',
    params: actionParams<'computer.drag'>([
        { syntax: '--from N', need: 'or --from-x/--from-y', field: 'from' },
        { syntax: '--from-x PX', need: 'with --from-y', field: 'fromX' },
        { syntax: '--from-y PX', need: 'with --from-x', field: 'fromY' },
        { syntax: '--to N', need: 'or --to-x/--to-y', field: 'to' },
        { syntax: '--to-x PX', need: 'with --to-y', field: 'toX' },
        { syntax: '--to-y PX', need: 'with --to-x', field: 'toY' }
    ]),
    detail: [
        'note\tIt presses at the start, moves in a few steps to the end and lets go there; for a slider, a split view, a file onto a window',
        'note\tThe start is checked like a click: a drag that would grab something else than --from is refused. The end is not, it may lie on another element',
        ...OUTCOME_PRINTS,
        ...COMMON_DETAIL
    ],
    positionals: appTuple('drag'),
    flags: z.object({
        from: wholeFlag('from', 0, 1_000_000),
        'from-x': pixelFlag('from-x'),
        'from-y': pixelFlag('from-y'),
        to: wholeFlag('to', 0, 1_000_000),
        'to-x': pixelFlag('to-x'),
        'to-y': pixelFlag('to-y'),
        ...ACTION_FLAGS
    }),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app], flags, switches }, call) {
        const outcome = await runAction(call, 'computer.drag', {
            app,
            from: flags.from ?? null,
            fromX: flags['from-x'] ?? null,
            fromY: flags['from-y'] ?? null,
            to: flags.to ?? null,
            toX: flags['to-x'] ?? null,
            toY: flags['to-y'] ?? null,
            ...thenState({ flags, switches })
        });
        return outcomeLines('drag', outcome);
    }
});

const type = defineActionVerb('computer', {
    name: 'type',
    action: 'computer.type',
    usage: '<app> --text T',
    params: actionParams<'computer.type'>([{ syntax: '--text T', need: 'required', field: 'text', more: 'write --text=T for text that starts with --' }]),
    detail: ['note\tIt types into whatever has the focus; click the field first. The app is brought to the front', ...OUTCOME_PRINTS, ...COMMON_DETAIL],
    positionals: appTuple('type'),
    flags: z.object({ text: z.string({ error: 'computer type needs --text' }).min(1, '--text needs the text to type'), ...ACTION_FLAGS }),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app], flags, switches }, call) {
        return outcomeLines('type', await runAction(call, 'computer.type', { app, text: flags.text, ...thenState({ flags, switches }) }));
    }
});

const key = defineActionVerb('computer', {
    name: 'key',
    action: 'computer.key',
    usage: '<app> <combo>...',
    params: actionParams<'computer.key'>([
        {
            syntax: '<combo>',
            need: 'one or more',
            field: 'combos',
            more: 'cmd, shift, option, ctrl and fn with a-z, 0-9, return, escape, tab, space, delete, the arrows, home, end, pageup, pagedown, f1-f12'
        }
    ]),
    detail: ['note\tKeys are the US positions of the keyboard; type is for text', ...OUTCOME_PRINTS, ...COMMON_DETAIL],
    positionals: z
        .tuple([z.string().min(1, 'computer key needs an app')], { error: 'computer key needs an app and at least one key combo' })
        .rest(z.string().min(1))
        .refine((words) => words.length >= 2, 'computer key needs at least one key combo after the app, such as cmd+n'),
    flags: z.object(ACTION_FLAGS),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app, ...combos], flags, switches }, call) {
        return outcomeLines('key', await runAction(call, 'computer.key', { app, combos, ...thenState({ flags, switches }) }));
    }
});

const setValue = defineActionVerb('computer', {
    name: 'set-value',
    action: 'computer.setValue',
    usage: '<app> --element N --value V',
    params: actionParams<'computer.setValue'>([
        { syntax: '--element N', need: 'required', field: 'element' },
        { syntax: '--value V', need: 'required', field: 'value' }
    ]),
    detail: ['note\tOnly where the app lets a value be set: text fields and areas, sliders; click and type otherwise', ...OUTCOME_PRINTS, ...COMMON_DETAIL],
    positionals: appTuple('set-value'),
    flags: z.object({
        element: z.string({ error: 'computer set-value needs --element' }).regex(/^\d+$/, '--element takes a whole number').transform(Number),
        value: z.string({ error: 'computer set-value needs --value' }),
        ...ACTION_FLAGS
    }),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app], flags, switches }, call) {
        const outcome = await runAction(call, 'computer.setValue', { app, element: flags.element, value: flags.value, ...thenState({ flags, switches }) });
        return outcomeLines('set-value', outcome);
    }
});

const menu = defineActionVerb('computer', {
    name: 'menu',
    action: 'computer.menu',
    usage: '<app> [<item>]',
    params: actionParams<'computer.menu'>([{ syntax: '<item>', need: 'optional', field: 'item', more: 'quote a path, it is one argument' }]),
    detail: [
        'prints\tmenu\tline\twithout an item: one row per menu item, indented, with [N], shortcuts, checked, disabled and > for a submenu',
        'note\tA disabled item is tried anyway: an app refreshes that only when the menu opens',
        ...OUTCOME_PRINTS,
        ...COMMON_DETAIL
    ],
    positionals: z
        .tuple([z.string().min(1, 'computer menu needs an app')], { error: 'computer menu needs an app' })
        .rest(z.string())
        .refine((words) => words.length <= 2, 'computer menu takes an app and at most one item; quote a path with spaces in it'),
    flags: z.object(ACTION_FLAGS),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app, item], flags, switches }, call) {
        const outcome = await runAction(call, 'computer.menu', { app, item: item ?? null, ...thenState({ flags, switches }) });
        if (outcome.listing !== null) {
            return [
                `done\tmenu\t${field(outcome.app?.name ?? app)}`,
                ...outcome.listing.map((line) => `menu\t${field(line)}`),
                ...(outcome.note === null ? [] : [`note\t${field(outcome.note)}`])
            ];
        }
        return outcomeLines('menu', outcome);
    }
});

const open = defineActionVerb('computer', {
    name: 'open',
    action: 'computer.open',
    usage: '<app>',
    params: actionParams<'computer.open'>([]),
    detail: [
        'note\tAn app that does not run yet is named by its bundle id or the file name of its bundle in /Applications, /System/Applications or ~/Applications',
        'note\tIt waits up to 5 s for a window; detail launched says whether it started the app',
        ...OUTCOME_PRINTS,
        ...COMMON_DETAIL
    ],
    positionals: appTuple('open'),
    flags: z.object(ACTION_FLAGS),
    switches: ACTION_SWITCHES,
    async run({ positionals: [app], flags, switches }, call) {
        return outcomeLines('open', await runAction(call, 'computer.open', { app, ...thenState({ flags, switches }) }));
    }
});

export const COMPUTER_ACTIONS = [apps, state, read, click, type, key, setValue, scroll, drag, menu, open, wait] as const;

export const COMPUTER_SUMMARY =
    'Reads and operates the apps of this machine, each only once a person let you into it; only while a person turned computer use on here';

export const COMPUTER_DETAIL: readonly string[] = [
    'first\truimte-context computer apps to see what runs and what you may operate, then open <app> or state <app> to read the whole window once',
    'loop\tAn action with --state acts and answers with what changed since then, marked + new, - gone, ~ changed; wait <app> --text T instead of sleeping; read for a text a state cut',
    'find\tstate --find T lists only the elements that hold T and what they sit in, and --within N one part of the window, for a window too big to read whole',
    'note\tThe screenshot is this machine’s, not the project’s: it lives outside the project folder and is swept an hour later',
    'off\tWhile computer use is off on this machine every action refuses with computer-use-off, and only a person turns it on',
    'grants\tUntil a person gave Ruimte Computer Use both Accessibility and Screen Recording every action refuses with not-granted; only they can, in the settings of Ruimte'
];
