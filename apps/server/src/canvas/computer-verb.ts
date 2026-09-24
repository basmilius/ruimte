import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { APPROVAL_WAIT_MS } from '../computer/approvals.ts';
import { defineActionVerb, runAction, type ActionParam } from './action-verb.ts';
import { field } from './verb.ts';

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

const STATE_PARAM = { syntax: '--state', need: 'no value', field: 'withState', more: 'the answer then ends in the state lines' } as const;

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

const CUT_FLAGS = {
    'max-depth': wholeFlag('max-depth', 1, 200),
    'max-elements': wholeFlag('max-elements', 1, 5000),
    'max-text': wholeFlag('max-text', 10, 10_000)
};

interface CutInput {
    flags: { 'max-depth'?: number; 'max-elements'?: number; 'max-text'?: number };
    switches: ReadonlySet<string>;
}

const cutOf = ({ flags, switches }: CutInput) => ({
    screenshot: !switches.has('no-screenshot'),
    maxDepth: flags['max-depth'] ?? null,
    maxElements: flags['max-elements'] ?? null,
    maxText: flags['max-text'] ?? null
});

/* The same for an action, which answers with the state after it only when --state asks. */
const thenState = (input: CutInput) => ({ withState: input.switches.has('state'), ...cutOf(input) });

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const round = (value: number): string => String(Math.round(value * 100) / 100);

/* A window, its picture and its tree: one row each, the tree a row per element with its indent kept. */
export const stateLines = (state: ComputerState): string[] => [
    `app\t${field(state.app.name)}\t${state.app.bundleId ?? '-'}\t${state.app.pid}`,
    `window\t${field(state.window.title)}\t${round(state.window.x)},${round(state.window.y)}\t${round(state.window.width)}x${round(state.window.height)}`,
    ...(state.window.sheet === null ? [] : [`sheet\t${field(state.window.sheet)}`]),
    state.screenshot === null
        ? `shot\tnone\t${field(state.screenshotError ?? '')}`
        : `shot\t${field(state.screenshot.path)}\t${state.screenshot.width}x${state.screenshot.height}\t${round(state.screenshot.scale)}\t${round(state.screenshot.originX)},${round(state.screenshot.originY)}`,
    `elements\t${state.elements}`,
    ...(state.truncated === null ? [] : [`truncated\t${field(state.truncated)}`]),
    ...(state.hidden ? ['hidden\tyes\tIts windows are off screen; computer open shows it'] : []),
    ...(state.note === null ? [] : [`note\t${field(state.note)}`]),
    ...state.tree.map((line) => `tree\t${field(line)}`)
];

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
    'prints\ttruncated, hidden, note\twhen the tree was cut, the app is hidden, or the helper has something to say'
];

const OUTCOME_PRINTS: readonly string[] = [
    'prints\tdone\taction\tapp',
    'prints\ttarget\trole\tlabel\tidentifier\twindow\twhat it acted on; for a click by pixel what was under it',
    'prints\tpoint\tx,y\twhere the pointer went, in screen points',
    'prints\tdetail\tkey\tvalue\twhat the helper reports of its own, such as method (AXPress or mouse), typed or pressed',
    'prints\tsettled\tyes|no\twith --state: whether the window stopped changing within 3 s; the state rows follow'
];

/* What holds for every action, said once per action so `help computer <action>` is whole. */
const COMMON_DETAIL: readonly string[] = [
    `approval\tThe first call in an app a person has not let you into puts a card in front of them and waits up to ${APPROVAL_WAIT_MS / 1000} s; refused awaiting-approval means the card is up: tell the person, and call again once they answered`,
    'approval\tA yes holds for this chat or terminal session, or for always on this machine; a no reaches you once, as declined. Every permission mode asks, full-access included',
    'terminal\tAn app that runs shells is refused whatever the person says; run commands in your own shell',
    'stop\tThe person stops you with Esc; every action after that refuses with stopped until they ask again',
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
    params: [APP_PARAM, ...CUT_PARAMS],
    detail: [...STATE_PRINTS, ...COMMON_DETAIL],
    positionals: appTuple('state'),
    flags: z.object(CUT_FLAGS),
    switches: ['no-screenshot'],
    async run({ positionals: [app], flags, switches }, call) {
        return stateLines(await runAction(call, 'computer.state', { app, ...cutOf({ flags, switches }) }));
    }
});

const ELEMENT_PARAM = { syntax: '--element N', need: 'or --x/--y', field: 'element' } as const;
const X_PARAM = { syntax: '--x PX', need: 'with --y', field: 'x' } as const;
const Y_PARAM = { syntax: '--y PX', need: 'with --x', field: 'y' } as const;

/* The params and flags of an action that answers with what it did and, with --state, the state after. */
const actionParams = <
    Name extends 'computer.click' | 'computer.scroll' | 'computer.type' | 'computer.key' | 'computer.setValue' | 'computer.menu' | 'computer.open'
>(
    own: readonly ActionParam<Name>[]
): ActionParam<Name>[] => [APP_PARAM, ...own, STATE_PARAM, ...CUT_PARAMS] as ActionParam<Name>[];

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
        ...CUT_FLAGS
    }),
    switches: ['state', 'no-screenshot'],
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
        ...CUT_FLAGS
    }),
    switches: ['state', 'no-screenshot'],
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

const type = defineActionVerb('computer', {
    name: 'type',
    action: 'computer.type',
    usage: '<app> --text T',
    params: actionParams<'computer.type'>([{ syntax: '--text T', need: 'required', field: 'text', more: 'write --text=T for text that starts with --' }]),
    detail: ['note\tIt types into whatever has the focus; click the field first. The app is brought to the front', ...OUTCOME_PRINTS, ...COMMON_DETAIL],
    positionals: appTuple('type'),
    flags: z.object({ text: z.string({ error: 'computer type needs --text' }).min(1, '--text needs the text to type'), ...CUT_FLAGS }),
    switches: ['state', 'no-screenshot'],
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
    flags: z.object(CUT_FLAGS),
    switches: ['state', 'no-screenshot'],
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
        ...CUT_FLAGS
    }),
    switches: ['state', 'no-screenshot'],
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
    flags: z.object(CUT_FLAGS),
    switches: ['state', 'no-screenshot'],
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
    flags: z.object(CUT_FLAGS),
    switches: ['state', 'no-screenshot'],
    async run({ positionals: [app], flags, switches }, call) {
        return outcomeLines('open', await runAction(call, 'computer.open', { app, ...thenState({ flags, switches }) }));
    }
});

export const COMPUTER_ACTIONS = [apps, state, click, type, key, setValue, scroll, menu, open] as const;

export const COMPUTER_SUMMARY =
    'Reads and operates the apps of this machine, each only once a person let you into it; only while a person turned computer use on here';

export const COMPUTER_DETAIL: readonly string[] = [
    'note\tA loop: open or apps, state to read the window and its elements, an action with --state to act and read the result in one call',
    'note\tThe screenshot is this machine’s, not the project’s: it lives outside the project folder and is swept an hour later',
    'off\tWhile computer use is off on this machine every action refuses with computer-use-off, and only a person turns it on'
];
