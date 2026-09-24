import type { ActionHandlers, ActionOutput } from '@ruimte/actions';
import { VerbRefusal, type ComputerHost } from '../canvas/verb.ts';
import type { OperateInput } from '../computer/computer-use.ts';
import type { ActionResult, AppCommand, StateResult } from '../computer/helper-protocol.ts';
import type { TreeView } from '../computer/tree-diff.ts';
import type { ServerActionContext } from './context.ts';

type ComputerState = ActionOutput<'computer.state'>;
type ComputerOutcome = ActionOutput<'computer.click'>;

/* How much of one text `read` passes on; a document in a text area can run to megabytes. */
export const READ_MAX_CHARS = 20_000;

/* The machine's helper, or the refusal for a machine built without one. */
const computerOf = ({ host }: ServerActionContext): ComputerHost => {
    if (!host.computer) {
        throw new VerbRefusal('unavailable', 'This machine cannot operate its apps');
    }
    return host.computer;
};

/* A state as the agent reads it; `view` says whether its tree is whole or only what changed. */
const stateOf = (state: StateResult, view: TreeView | null = null): ComputerState => {
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
        tree: view?.kind === 'diff' ? view.lines : state.tree,
        truncated: state.truncated ?? null,
        hidden: state.hidden === true,
        note: state.note ?? null,
        diff: view?.kind === 'diff' ? { added: view.added, gone: view.gone, changed: view.changed } : null,
        full: view?.kind === 'full' ? view.reason : null,
        matches: state.matches ?? null,
        within: null
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

/* A state that came after an action, told as the agent asked: what changed, or all of it. */
type StateSeen = (state: StateResult) => TreeView;

export const outcomeOf = (result: ActionResult, seen: StateSeen = () => ({ kind: 'full', reason: null })): ComputerOutcome => {
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
        state: state !== undefined && !('error' in state) ? stateOf(state, seen(state)) : null,
        stateError: state !== undefined && 'error' in state ? state.error : null
    };
};

interface CutInput {
    withState?: boolean | null;
    screenshot?: boolean | null;
    maxDepth?: number | null;
    maxElements?: number | null;
    maxText?: number | null;
}

/* The helper's own spelling of the options every call shares; a field left out stays out. */
const cutOf = (input: CutInput): OperateInput => ({
    ...(input.withState ? { withState: true } : {}),
    ...(input.screenshot === false ? { screenshot: false } : {}),
    ...(given(input.maxDepth) ? { maxDepth: input.maxDepth } : {}),
    ...(given(input.maxElements) ? { maxElements: input.maxElements } : {}),
    ...(given(input.maxText) ? { maxText: input.maxText } : {})
});

/* The hold an agent asked for with --wait, in the milliseconds the service counts in. */
const holdOf = (input: { wait?: number | null }): number | undefined => (given(input.wait) ? input.wait * 1000 : undefined);

interface Place {
    element?: number | null;
    x?: number | null;
    y?: number | null;
}

/* Where a click, a scroll or one end of a drag lands: an element, or both halves of a pixel, never a mix. */
const placeOf = ({ element, x, y }: Place, refusal: string): { element: number } | { x: number; y: number } => {
    if (given(element) && !given(x) && !given(y)) {
        return { element };
    }
    if (!given(element) && given(x) && given(y)) {
        return { x, y };
    }
    throw new VerbRefusal('bad-arguments', refusal);
};

const pointOf = (place: Place, verb: string): OperateInput => placeOf(place, `computer ${verb} takes --element N, or both --x and --y, and not both`);

/* Runs an action and tells the state after it as the agent asked: what changed, unless it asked for all of it. */
const act = async (
    context: ServerActionContext,
    callerId: string,
    command: Exclude<AppCommand, 'state' | 'read' | 'wait'>,
    input: CutInput & { app: string; wait?: number | null; fullState?: boolean | null },
    fields: OperateInput = {}
): Promise<{ result: ActionResult; outcome: ComputerOutcome }> => {
    const computer = computerOf(context);
    const result = await computer.operate(callerId, command, input.app, { ...cutOf(input), ...fields }, holdOf(input));
    return { result, outcome: outcomeOf(result, (state) => computer.treeView(callerId, state, input.fullState ? 'full' : 'diff')) };
};

/* How long `wait` waits for its condition without --timeout, in seconds. */
export const WAIT_TIMEOUT_S = 10;

/* What `wait` holds out for: exactly one of a text that appears, a text that goes, or the value of an element. */
const conditionOf = ({
    text,
    gone,
    element,
    value
}: {
    text?: string | null;
    gone?: string | null;
    element?: number | null;
    value?: string | null;
}): OperateInput => {
    if ([given(text), given(gone), given(element) || given(value)].filter(Boolean).length === 1) {
        if (given(text)) {
            return { text };
        }
        if (given(gone)) {
            return { gone };
        }
        if (given(element) && given(value)) {
            return { element, value };
        }
    }
    throw new VerbRefusal('bad-arguments', 'computer wait takes one of --text T, --gone T, or --element N with --value V');
};

/* The start of a text too long to pass on whole, counted in characters so a cut never splits one. */
const capped = (text: string | undefined, key: string, cut: Record<string, number>): string | null => {
    if (text === undefined) {
        return null;
    }
    if (text.length <= READ_MAX_CHARS) {
        return text;
    }
    const characters = Array.from(text);
    if (characters.length <= READ_MAX_CHARS) {
        return text;
    }
    cut[key] = characters.length;
    return characters.slice(0, READ_MAX_CHARS).join('');
};

const appRefOf = (app: { name: string; bundleId?: string; pid: number }) => ({ name: app.name, bundleId: app.bundleId ?? null, pid: app.pid });

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
    'computer.state': async (input, { actor, context }) => {
        const computer = computerOf(context);
        const part = { ...(given(input.find) ? { find: input.find } : {}), ...(given(input.within) ? { within: input.within } : {}) };
        const state = await computer.operate(actor.id, 'state', input.app, { ...cutOf(input), ...part }, holdOf(input));
        // Only a whole window is a tree the next change can be told against.
        const whole = !given(input.find) && !given(input.within);
        return { output: { ...stateOf(state, whole ? computer.treeView(actor.id, state, 'full') : null), within: input.within ?? null } };
    },
    'computer.read': async (input, { actor, context }) => {
        const read = await computerOf(context).operate(actor.id, 'read', input.app, { element: input.element }, holdOf(input));
        const cut: Record<string, number> = {};
        return {
            output: {
                app: appRefOf(read.app),
                element: read.element,
                role: read.role,
                title: capped(read.title, 'title', cut),
                value: capped(read.value, 'value', cut),
                description: capped(read.description, 'description', cut),
                placeholder: capped(read.placeholder, 'placeholder', cut),
                identifier: capped(read.identifier, 'identifier', cut),
                frame: read.frame ?? null,
                cut
            }
        };
    },
    'computer.wait': async (input, { actor, context }) => {
        const condition = conditionOf(input);
        const computer = computerOf(context);
        const result = await computer.operate(
            actor.id,
            'wait',
            input.app,
            { ...cutOf(input), ...condition, timeout: input.timeout ?? WAIT_TIMEOUT_S },
            holdOf(input)
        );
        const { state } = result;
        return {
            output: {
                app: appRefOf(result.app),
                met: result.met,
                condition: result.condition,
                waited: result.waited,
                state: 'error' in state ? null : stateOf(state, computer.treeView(actor.id, state, input.fullState ? 'full' : 'diff')),
                stateError: 'error' in state ? state.error : null
            }
        };
    },
    'computer.click': async (input, { actor, context }) => {
        const extra = { ...(given(input.count) ? { count: input.count } : {}), ...(given(input.button) ? { button: input.button } : {}) };
        return { output: (await act(context, actor.id, 'click', input, { ...pointOf(input, 'click'), ...extra })).outcome };
    },
    'computer.scroll': async (input, { actor, context }) => {
        const extra = { direction: input.direction, ...(given(input.pages) ? { pages: input.pages } : {}) };
        return { output: (await act(context, actor.id, 'scroll', input, { ...pointOf(input, 'scroll'), ...extra })).outcome };
    },
    'computer.drag': async (input, { actor, context }) => {
        const from = placeOf(
            { element: input.from, x: input.fromX, y: input.fromY },
            'computer drag starts at --from N, or at both --from-x and --from-y, and not both'
        );
        const to = placeOf({ element: input.to, x: input.toX, y: input.toY }, 'computer drag ends at --to N, or at both --to-x and --to-y, and not both');
        const end = 'element' in to ? { toElement: to.element } : { toX: to.x, toY: to.y };
        return { output: (await act(context, actor.id, 'drag', input, { ...from, ...end })).outcome };
    },
    'computer.type': async (input, { actor, context }) => ({
        output: (await act(context, actor.id, 'type', input, { text: input.text })).outcome
    }),
    'computer.key': async (input, { actor, context }) => ({
        output: (await act(context, actor.id, 'key', input, { combos: input.combos })).outcome
    }),
    'computer.setValue': async (input, { actor, context }) => ({
        output: (await act(context, actor.id, 'set-value', input, { element: input.element, value: input.value })).outcome
    }),
    'computer.menu': async (input, { actor, context }) => {
        const { result, outcome } = await act(context, actor.id, 'menu', input, given(input.item) ? { path: input.item } : {});
        return { output: { ...outcome, listing: Array.isArray(result.menu) ? result.menu : null } };
    },
    'computer.open': async (input, { actor, context }) => ({
        output: (await act(context, actor.id, 'open', input)).outcome
    })
};
