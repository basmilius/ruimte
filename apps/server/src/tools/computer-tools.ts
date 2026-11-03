import { ToolRefusal } from '@adecore/agents/context';
import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { READ_MAX_CHARS } from '../actions/computer-actions.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineTool, defineToolkit, type ToolCall } from './tool.ts';
import { field, requiredField, yesNo } from './host.ts';

type ComputerState = ActionOutput<'computer.state'>;
type ComputerOutcome = ActionOutput<'computer.click'>;

const ACTS = ['click', 'type', 'key', 'set-value', 'scroll', 'drag'] as const;

type Act = (typeof ACTS)[number];

/* What each action of `computer_act` takes besides the fields every action shares. */
const ACT_FIELDS: Readonly<Record<Act, readonly string[]>> = {
    click: ['element', 'x', 'y', 'count', 'button'],
    type: ['text'],
    key: ['combo'],
    'set-value': ['element', 'value'],
    scroll: ['element', 'x', 'y', 'direction', 'pages'],
    drag: ['from', 'from_x', 'from_y', 'to', 'to_x', 'to_y']
};

const SHARED_ACT_FIELDS = ['action', 'app', 'state', 'wait', 'max_depth', 'max_elements', 'max_text', 'no_screenshot', 'front'];

function wholeInput(name: string, min: number, max: number) {
    return z
        .number({ error: `${name} takes a whole number` })
        .int(`${name} takes a whole number`)
        .min(min, `${name} is between ${min} and ${max}`)
        .max(max, `${name} is between ${min} and ${max}`);
}

function pixelInput(name: string) {
    return z
        .number({ error: `${name} takes a pixel of the last screenshot, a number of 0 or more` })
        .min(0, `${name} takes a pixel of the last screenshot, a number of 0 or more`);
}

function appInput(tool: string) {
    return requiredField(`${tool} needs app, the name, bundle id or pid of an app`).describe('Name, bundle id or pid');
}

const ELEMENT_INPUT = wholeInput('element', 0, 1_000_000);

const WAIT_INPUT = wholeInput('wait', 1, 110).optional().describe('Seconds to hold for the person');

const FRONT_INPUT = z.boolean().optional().describe('Real pointer and keyboard; interrupts the person, so ask first');

/* How long a call holds for the person, and how the state it answers with is cut. */
const CUT_INPUT = {
    wait: WAIT_INPUT,
    max_depth: wholeInput('max_depth', 1, 200).optional(),
    max_elements: wholeInput('max_elements', 1, 5000).optional(),
    max_text: wholeInput('max_text', 10, 10_000).optional(),
    no_screenshot: z.boolean().optional(),
    front: FRONT_INPUT
};

/* The fields of an action, which answers with the state after it only when `state` asks. */
const ACTION_INPUT = {
    state: z.enum(['on', 'full'], { error: 'state is on, or full for the whole tree' }).optional().describe('on answers what changed, full the whole tree'),
    ...CUT_INPUT
};

interface CutInput {
    wait?: number;
    max_depth?: number;
    max_elements?: number;
    max_text?: number;
    no_screenshot?: boolean;
    front?: boolean;
}

function cutOf(input: CutInput) {
    return {
        wait: input.wait ?? null,
        front: input.front === true,
        screenshot: input.no_screenshot !== true,
        maxDepth: input.max_depth ?? null,
        maxElements: input.max_elements ?? null,
        maxText: input.max_text ?? null
    };
}

function thenState(input: CutInput & { state?: 'on' | 'full' }) {
    return { withState: input.state !== undefined, fullState: input.state === 'full', ...cutOf(input) };
}

function round(value: number): string {
    return String(Math.round(value * 100) / 100);
}

function windowLines(state: ComputerState, call: ToolCall): string[] {
    if (state.screenshot !== null) {
        call.image(state.screenshot.path);
    }

    return [
        `window\t${field(state.window.title)}\t${round(state.window.x)},${round(state.window.y)}\t${round(state.window.width)}x${round(state.window.height)}`,
        ...(state.window.sheet === null ? [] : [`sheet\t${field(state.window.sheet)}`]),
        state.screenshot === null
            ? `shot\tnone\t${field(state.screenshotError ?? '')}`
            : `shot\t${field(state.screenshot.path)}\t${state.screenshot.width}x${state.screenshot.height}\t${round(state.screenshot.scale)}\t${round(state.screenshot.originX)},${round(state.screenshot.originY)}`
    ];
}

function remarkLines(state: ComputerState): string[] {
    return [
        ...(state.truncated === null ? [] : [`truncated\t${field(state.truncated)}`]),
        ...(state.hidden ? ['hidden\tyes\tIts windows are off screen; computer_open shows it'] : []),
        ...(state.note === null ? [] : [`note\t${field(state.note)}`])
    ];
}

function changeCounts({ added, gone, changed }: { added: number; gone: number; changed: number }): string {
    return added + gone + changed === 0 ? 'none' : `${added} new\t${gone} gone\t${changed} changed`;
}

/*
 * A window, its picture and its tree: one row each, the tree a row per element with its indent kept.
 * After an action that is only what changed, since the rest is what the agent read before.
 */
function stateLines(state: ComputerState, call: ToolCall): string[] {
    const tree = state.tree.map((line) => `tree\t${field(line)}`);

    if (state.diff !== null && state.diff !== undefined) {
        return [...windowLines(state, call), ...remarkLines(state), `changes\t${changeCounts(state.diff)}`, ...tree];
    }

    return [
        `app\t${field(state.app.name)}\t${state.app.bundleId ?? '-'}\t${state.app.pid}`,
        ...windowLines(state, call),
        `elements\t${state.elements}`,
        ...(state.matches === null || state.matches === undefined ? [] : [`matches\t${state.matches}`]),
        ...(state.within === null || state.within === undefined ? [] : [`within\t${state.within}`]),
        ...remarkLines(state),
        ...(state.full === null || state.full === undefined ? [] : [`full\t${field(state.full)}`]),
        ...tree
    ];
}

/* What an action did, and the state after it when it was asked for. */
function outcomeLines(word: string, outcome: ComputerOutcome, call: ToolCall): string[] {
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
        ...(outcome.state === null ? [] : stateLines(outcome.state, call))
    ];
}

const computerApps = defineActionTool('computer', {
    name: 'computer_apps',
    action: 'computer.apps',
    description: 'Lists the running apps and how far you may use each.',
    annotations: { readOnly: true },
    audience: 'computer',
    input: z.object({}),
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

const computerState = defineActionTool('computer', {
    name: 'computer_state',
    action: 'computer.state',
    description: "Reads the accessibility tree of an app's key window, with a picture of it.",
    annotations: { readOnly: true },
    audience: 'computer',
    input: z.object({
        app: appInput('computer_state'),
        find: z.string().min(1, 'find needs the text to look for').optional(),
        within: wholeInput('within', 0, 1_000_000).optional().describe('An element of the last state to read inside'),
        ...CUT_INPUT
    }),
    async run(input, call) {
        const state = await runAction(call, 'computer.state', { app: input.app, find: input.find ?? null, within: input.within ?? null, ...cutOf(input) });

        return stateLines(state, call);
    }
});

const computerRead = defineActionTool('computer', {
    name: 'computer_read',
    action: 'computer.read',
    description: 'Reads one element of an app whole.',
    annotations: { readOnly: true },
    audience: 'computer',
    input: z.object({
        app: appInput('computer_read'),
        element: wholeInput('element', 0, 1_000_000).describe('From the last state'),
        wait: WAIT_INPUT,
        front: FRONT_INPUT
    }),
    async run(input, call) {
        const read = await runAction(call, 'computer.read', { app: input.app, element: input.element, wait: input.wait ?? null, front: input.front === true });
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

const computerWait = defineActionTool('computer', {
    name: 'computer_wait',
    action: 'computer.wait',
    description: 'Waits until a text appears or goes, or an element has a value.',
    audience: 'computer',
    input: z.object({
        app: appInput('computer_wait'),
        text: z.string().min(1, 'text needs the text to wait for').optional(),
        gone: z.string().min(1, 'gone needs the text to wait for').optional(),
        element: ELEMENT_INPUT.optional().describe('With value'),
        value: z.string().optional().describe('With element'),
        timeout: wholeInput('timeout', 1, 110).optional().describe('Seconds, at most 110'),
        ...ACTION_INPUT,
        state: ACTION_INPUT.state.describe('full answers the whole tree, not what changed')
    }),
    async run(input, call) {
        const outcome = await runAction(call, 'computer.wait', {
            app: input.app,
            text: input.text ?? null,
            gone: input.gone ?? null,
            element: input.element ?? null,
            value: input.value ?? null,
            timeout: input.timeout ?? null,
            fullState: input.state === 'full',
            ...cutOf(input)
        });
        const lines = [
            ...(outcome.stateError === null ? [] : [`state\tnone\t${field(outcome.stateError)}`]),
            ...(outcome.state === null ? [] : stateLines(outcome.state, call))
        ];

        if (!outcome.met) {
            throw new ToolRefusal(
                'timeout',
                `Waited ${round(outcome.waited)} s for ${outcome.condition}, and it did not happen. The state below is how the window stands now; wait again with a longer timeout, or act on what you see`,
                lines
            );
        }

        return [`done\twait\t${field(outcome.app.name)}\t${field(outcome.condition)}\t${round(outcome.waited)}`, ...lines];
    }
});

/* A click, typing, keys, a value, a scroll and a drag meet the same approval and answer alike, so one tool picks among them. */
const computerAct = defineTool('computer', {
    name: 'computer_act',
    description: 'Clicks, types, presses keys, sets a value, scrolls or drags in an app.',
    audience: 'computer',
    input: z.object({
        action: z.enum(ACTS, { error: `computer_act needs action, one of ${ACTS.join(', ')}` }),
        app: appInput('computer_act'),
        element: ELEMENT_INPUT.optional().describe('From the last state'),
        x: pixelInput('x').optional(),
        y: pixelInput('y').optional(),
        count: wholeInput('count', 1, 3).optional().describe('For click, 2 for a double click'),
        button: z.enum(['left', 'right'], { error: 'button is left or right' }).optional().describe('For click'),
        ...ACTION_INPUT,
        text: z.string().min(1, 'text needs the text to type').optional().describe('For type'),
        combo: z.array(z.string().min(1, 'combo has an empty key combo in it')).optional().describe('For key, such as cmd+n or shift+tab'),
        value: z.string().optional().describe('For set-value'),
        direction: z.enum(['up', 'down', 'left', 'right'], { error: 'direction is up, down, left or right' }).optional().describe('For scroll'),
        pages: z
            .number({ error: 'pages takes a number' })
            .gt(0, 'pages is above 0 and at most 50')
            .max(50, 'pages is above 0 and at most 50')
            .optional()
            .describe('For scroll'),
        from: ELEMENT_INPUT.optional().describe('For drag, the element it presses on'),
        from_x: pixelInput('from_x').optional(),
        from_y: pixelInput('from_y').optional(),
        to: ELEMENT_INPUT.optional().describe('For drag, the element it lets go on'),
        to_x: pixelInput('to_x').optional(),
        to_y: pixelInput('to_y').optional()
    }),
    async run(input, call) {
        const own = ACT_FIELDS[input.action];
        const given = [...new Set(Object.values(ACT_FIELDS).flat())].filter((key) => !own.includes(key) && input[key as keyof typeof input] !== undefined);

        if (given.length > 0) {
            throw new ToolRefusal('bad-arguments', `computer_act ${input.action} takes no ${given.join(', ')}`, [
                `fields\t${[...SHARED_ACT_FIELDS, ...own].join('\t')}`
            ]);
        }

        const { app } = input;
        const after = thenState(input);
        const point = { element: input.element ?? null, x: input.x ?? null, y: input.y ?? null };

        switch (input.action) {
            case 'click': {
                const outcome = await runAction(call, 'computer.click', { app, ...point, count: input.count ?? null, button: input.button ?? null, ...after });

                return outcomeLines('click', outcome, call);
            }

            case 'type': {
                if (input.text === undefined) {
                    throw new ToolRefusal('bad-arguments', 'computer_act type needs text, the text to type');
                }

                return outcomeLines('type', await runAction(call, 'computer.type', { app, text: input.text, ...after }), call);
            }

            case 'key': {
                if (input.combo === undefined || input.combo.length === 0) {
                    throw new ToolRefusal('bad-arguments', 'computer_act key needs combo, at least one key combo such as cmd+n');
                }

                return outcomeLines('key', await runAction(call, 'computer.key', { app, combos: input.combo, ...after }), call);
            }

            case 'set-value': {
                if (input.element === undefined || input.value === undefined) {
                    throw new ToolRefusal('bad-arguments', `computer_act set-value needs ${input.element === undefined ? 'element' : 'value'}`);
                }

                const outcome = await runAction(call, 'computer.setValue', { app, element: input.element, value: input.value, ...after });

                return outcomeLines('set-value', outcome, call);
            }

            case 'scroll': {
                if (input.direction === undefined) {
                    throw new ToolRefusal('bad-arguments', 'computer_act scroll needs direction, one of up, down, left and right');
                }

                const outcome = await runAction(call, 'computer.scroll', { app, ...point, direction: input.direction, pages: input.pages ?? null, ...after });

                return outcomeLines('scroll', outcome, call);
            }

            case 'drag': {
                const outcome = await runAction(call, 'computer.drag', {
                    app,
                    from: input.from ?? null,
                    fromX: input.from_x ?? null,
                    fromY: input.from_y ?? null,
                    to: input.to ?? null,
                    toX: input.to_x ?? null,
                    toY: input.to_y ?? null,
                    ...after
                });

                return outcomeLines('drag', outcome, call);
            }
        }
    }
});

const computerMenu = defineActionTool('computer', {
    name: 'computer_menu',
    action: 'computer.menu',
    description: 'Lists the menu bar of an app, or runs one of its items.',
    audience: 'computer',
    input: z.object({
        app: appInput('computer_menu'),
        item: z
            .array(z.string())
            .max(1, 'computer_menu takes at most one item; a path such as File > Save is one')
            .optional()
            .describe('A number from the last listing, or a path such as File > Save'),
        ...ACTION_INPUT
    }),
    async run(input, call) {
        const outcome = await runAction(call, 'computer.menu', { app: input.app, item: input.item?.[0] ?? null, ...thenState(input) });

        if (outcome.listing !== null) {
            return [
                `done\tmenu\t${field(outcome.app?.name ?? input.app)}`,
                ...outcome.listing.map((line) => `menu\t${field(line)}`),
                ...(outcome.note === null ? [] : [`note\t${field(outcome.note)}`])
            ];
        }

        return outcomeLines('menu', outcome, call);
    }
});

const computerOpen = defineActionTool('computer', {
    name: 'computer_open',
    action: 'computer.open',
    description: 'Starts or shows an app and waits for a window.',
    audience: 'computer',
    input: z.object({ app: appInput('computer_open'), ...ACTION_INPUT }),
    async run(input, call) {
        return outcomeLines('open', await runAction(call, 'computer.open', { app: input.app, ...thenState(input) }), call);
    }
});

/* Named as the usage counter its calls add to, which the usage report and the client know. */
export const computerToolkit = defineToolkit('computer', [computerApps, computerState, computerRead, computerWait, computerAct, computerMenu, computerOpen]);
