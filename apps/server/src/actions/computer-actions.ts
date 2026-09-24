import type { ActionHandlers, ActionOutput } from '@ruimte/actions';
import { VerbRefusal, type ComputerHost } from '../canvas/verb.ts';
import type { OperateInput } from '../computer/computer-use.ts';
import type { ActionResult, StateResult } from '../computer/helper-protocol.ts';
import type { ServerActionContext } from './context.ts';

type ComputerState = ActionOutput<'computer.state'>;
type ComputerOutcome = ActionOutput<'computer.click'>;

/* The machine's helper, or the refusal for a machine built without one. */
const computerOf = ({ host }: ServerActionContext): ComputerHost => {
    if (!host.computer) {
        throw new VerbRefusal('unavailable', 'This machine cannot operate its apps');
    }
    return host.computer;
};

const stateOf = (state: StateResult): ComputerState => {
    const { screenshot } = state;
    const shot =
        screenshot.path !== undefined && screenshot.origin !== undefined
            ? {
                  path: screenshot.path,
                  width: screenshot.width ?? 0,
                  height: screenshot.height ?? 0,
                  scale: screenshot.scale ?? 1,
                  originX: screenshot.origin.x,
                  originY: screenshot.origin.y
              }
            : null;
    return {
        app: { name: state.app.name, bundleId: state.app.bundleId ?? null, pid: state.app.pid },
        window: { title: state.window.title, ...state.window.frame, sheet: state.window.sheet ?? null },
        screenshot: shot,
        screenshotError: shot === null ? (screenshot.error ?? 'no picture was taken') : null,
        elements: state.elements,
        tree: state.tree,
        truncated: state.truncated ?? null,
        hidden: state.hidden === true,
        note: state.note ?? null
    };
};

const given = <Value>(value: Value | null | undefined): value is Value => value !== null && value !== undefined;

/* The fields every action shares, and the scalars it reported of its own as words. */
const SHARED = new Set(['app', 'target', 'point', 'settled', 'state', 'menu', 'note', 'truncated']);

const scalar = (value: unknown): string | null => {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        return value.join(' ');
    }
    return null;
};

export const outcomeOf = (result: ActionResult): ComputerOutcome => {
    const details: Record<string, string> = {};
    for (const [key, value] of Object.entries(result)) {
        const text = SHARED.has(key) ? null : scalar(value);
        if (text !== null) {
            details[key] = text;
        }
    }
    if (typeof result.menu === 'string') {
        details.menu = result.menu;
    }
    const state = result.state;
    return {
        app: result.app ? { name: result.app.name, bundleId: result.app.bundleId ?? null, pid: result.app.pid } : null,
        target: result.target
            ? {
                  role: result.target.role ?? null,
                  label: result.target.label ?? null,
                  identifier: result.target.identifier ?? null,
                  window: result.target.window ?? null,
                  sheet: result.target.sheet ?? null
              }
            : null,
        point: result.point ?? null,
        details,
        note: [result.note, result.truncated].filter((part): part is string => part !== undefined).join('; ') || null,
        settled: result.settled ?? null,
        state: state !== undefined && !('error' in state) ? stateOf(state) : null,
        stateError: state !== undefined && 'error' in state ? state.error : null
    };
};

/* The helper's own spelling of the options every call shares; a field left out stays out. */
const cutOf = (input: {
    withState?: boolean | null;
    screenshot?: boolean | null;
    maxDepth?: number | null;
    maxElements?: number | null;
    maxText?: number | null;
}): OperateInput => ({
    ...(input.withState ? { withState: true } : {}),
    ...(input.screenshot === false ? { screenshot: false } : {}),
    ...(given(input.maxDepth) ? { maxDepth: input.maxDepth } : {}),
    ...(given(input.maxElements) ? { maxElements: input.maxElements } : {}),
    ...(given(input.maxText) ? { maxText: input.maxText } : {})
});

/* The hold an agent asked for with --wait, in the milliseconds the service counts in. */
const holdOf = (input: { wait?: number | null }): number | undefined => (given(input.wait) ? input.wait * 1000 : undefined);

/* Where a click or a scroll lands: an element, or both halves of a pixel, never a mix. */
const placeOf = ({ element, x, y }: { element?: number | null; x?: number | null; y?: number | null }, verb: string): OperateInput => {
    if (given(element) && !given(x) && !given(y)) {
        return { element };
    }
    if (!given(element) && given(x) && given(y)) {
        return { x, y };
    }
    throw new VerbRefusal('bad-arguments', `computer ${verb} takes --element N, or both --x and --y, and not both`);
};

export const computerActions: ActionHandlers<ServerActionContext> = {
    'computer.apps': async (_input, { actor, context }) => {
        const { apps, doctor } = await computerOf(context).apps(actor.id);
        return {
            output: {
                screenRecording: doctor.screenRecording.granted,
                apps: apps.map(({ app, access }) => ({
                    name: app.name,
                    bundleId: app.bundleId ?? null,
                    pid: app.pid,
                    frontmost: app.frontmost === true,
                    hidden: app.hidden === true,
                    access
                }))
            }
        };
    },
    'computer.state': async (input, { actor, context }) => ({
        output: stateOf(await computerOf(context).operate(actor.id, 'state', input.app, cutOf(input), holdOf(input)))
    }),
    'computer.click': async (input, { actor, context }) => {
        const place = placeOf(input, 'click');
        const extra = { ...(given(input.count) ? { count: input.count } : {}), ...(given(input.button) ? { button: input.button } : {}) };
        return { output: outcomeOf(await computerOf(context).operate(actor.id, 'click', input.app, { ...cutOf(input), ...place, ...extra }, holdOf(input))) };
    },
    'computer.scroll': async (input, { actor, context }) => {
        const place = placeOf(input, 'scroll');
        const extra = { direction: input.direction, ...(given(input.pages) ? { pages: input.pages } : {}) };
        return { output: outcomeOf(await computerOf(context).operate(actor.id, 'scroll', input.app, { ...cutOf(input), ...place, ...extra }, holdOf(input))) };
    },
    'computer.type': async (input, { actor, context }) => ({
        output: outcomeOf(await computerOf(context).operate(actor.id, 'type', input.app, { ...cutOf(input), text: input.text }, holdOf(input)))
    }),
    'computer.key': async (input, { actor, context }) => ({
        output: outcomeOf(await computerOf(context).operate(actor.id, 'key', input.app, { ...cutOf(input), combos: input.combos }, holdOf(input)))
    }),
    'computer.setValue': async (input, { actor, context }) => ({
        output: outcomeOf(
            await computerOf(context).operate(actor.id, 'set-value', input.app, { ...cutOf(input), element: input.element, value: input.value }, holdOf(input))
        )
    }),
    'computer.menu': async (input, { actor, context }) => {
        const result = await computerOf(context).operate(
            actor.id,
            'menu',
            input.app,
            { ...cutOf(input), ...(given(input.item) ? { path: input.item } : {}) },
            holdOf(input)
        );
        return { output: { ...outcomeOf(result), listing: Array.isArray(result.menu) ? result.menu : null } };
    },
    'computer.open': async (input, { actor, context }) => ({
        output: outcomeOf(await computerOf(context).operate(actor.id, 'open', input.app, cutOf(input), holdOf(input)))
    })
};
