import type { AgentKind, Plan, PlanItem, PlanSection, PlanStep, PlanStepState, PlanText } from '@ruimte/contracts';
import { allItems, allSteps, isParentStep, planProgress, stepState, type PlanProgress } from '@ruimte/plan';

/* Which steps the panel lists; local to this client, never part of the plan. */
export type PlanFilter = 'all' | 'open' | 'issues';

export interface PlanViewOptions {
    filter: PlanFilter;
    /* Folds every section and parent step whose steps are all done or skipped. */
    collapseDone: boolean;
    /* The sections and parent steps a person folded. */
    collapsed: ReadonlySet<string>;
}

export type PlanRow =
    | { type: 'section'; item: PlanSection; collapsed: boolean; progress: PlanProgress }
    | { type: 'text'; item: PlanText; depth: number }
    | {
          type: 'step';
          item: PlanStep;
          depth: number;
          state: PlanStepState;
          /* Only for a step with sub-steps, which shows its count instead of a mark of its own. */
          progress: PlanProgress | null;
          collapsed: boolean;
          /* A step under this one is active, so a folded parent still says where the work is. */
          activeBelow: boolean;
      };

const LEAF_MATCHES: Record<Exclude<PlanFilter, 'all'>, ReadonlySet<PlanStepState>> = {
    open: new Set(['open', 'active', 'blocked']),
    issues: new Set(['failed', 'blocked', 'warning'])
};

const leavesOf = (items: readonly PlanItem[]): PlanStep[] => allSteps(items).filter((step) => !isParentStep(step));

const matches = (items: readonly PlanItem[], filter: PlanFilter): boolean =>
    filter === 'all' || leavesOf(items).some((step) => LEAF_MATCHES[filter].has(step.state ?? 'open'));

const allDone = (items: readonly PlanItem[]): boolean => {
    const leaves = leavesOf(items);
    return leaves.length > 0 && leaves.every((step) => step.state === 'done' || step.state === 'skipped');
};

/* The plan as the rows the panel draws, in document order, with folds and the filter applied. */
export const planRows = (plan: Pick<Plan, 'items'>, options: PlanViewOptions): PlanRow[] => {
    const rows: PlanRow[] = [];
    const folded = (item: PlanSection | PlanStep, children: readonly PlanItem[]): boolean =>
        options.collapsed.has(item.id) || (options.collapseDone && allDone(children));

    const step = (item: PlanStep, depth: number): void => {
        if (!matches([item], options.filter)) {
            return;
        }
        const parent = isParentStep(item);
        const collapsed = parent && folded(item, item.steps!);
        rows.push({
            type: 'step',
            item,
            depth,
            state: stepState(item),
            progress: parent ? planProgress(item.steps!) : null,
            collapsed,
            activeBelow: parent && leavesOf(item.steps!).some((leaf) => leaf.state === 'active')
        });
        if (parent && !collapsed) {
            for (const child of item.steps!) {
                step(child, depth + 1);
            }
        }
    };

    const entry = (item: PlanItem): void => {
        if (item.type === 'text') {
            if (options.filter === 'all') {
                rows.push({ type: 'text', item, depth: 0 });
            }
            return;
        }
        if (item.type === 'step') {
            step(item, 0);
            return;
        }
        if (options.filter !== 'all' && !matches(item.items, options.filter)) {
            return;
        }
        const collapsed = folded(item, item.items);
        rows.push({ type: 'section', item, collapsed, progress: planProgress(item.items) });
        if (!collapsed) {
            item.items.forEach(entry);
        }
    };

    plan.items.forEach(entry);
    return rows;
};

/* Every section and parent step, what "Collapse all" folds. */
export const foldableIds = (plan: Pick<Plan, 'items'>): string[] =>
    allItems(plan.items)
        .filter((item) => item.type === 'section' || (item.type === 'step' && isParentStep(item)))
        .map((item) => item.id);

/* "Plan 6/11": steps with an outcome over all steps, the counter `plan read` uses too. */
export const planCounter = (plan: Pick<Plan, 'items'>): string => {
    const progress = planProgress(plan.items);
    return `${progress.finished}/${progress.total}`;
};

export const hasFailedStep = (plan: Pick<Plan, 'items'>): boolean => leavesOf(plan.items).some((step) => step.state === 'failed');

export interface ActiveStep {
    id: string;
    title: string;
}

/* The steps an agent is on, in document order. */
export const activeSteps = (plan: Pick<Plan, 'items'>): ActiveStep[] =>
    leavesOf(plan.items)
        .filter((step) => step.state === 'active')
        .map((step) => ({ id: step.id, title: step.title }));

export const sameActiveSteps = (a: readonly ActiveStep[], b: readonly ActiveStep[]): boolean =>
    a.length === b.length && a.every((step, i) => step.id === b[i].id && step.title === b[i].title);

/* "Fix focus", or "Fix focus and 2 more". */
export const activeStepsLabel = (steps: readonly ActiveStep[]): string => {
    if (steps.length === 0) {
        return '';
    }
    return steps.length === 1 ? steps[0].title : `${steps[0].title} and ${steps.length - 1} more`;
};

/* The step a click on the active item goes to: the first, and on each next click the one after the last. */
export const nextActiveTarget = (steps: readonly ActiveStep[], last: string | null): string | null => {
    if (steps.length === 0) {
        return null;
    }
    const index = steps.findIndex((step) => step.id === last);
    return steps[(index + 1) % steps.length].id;
};

/* The sections and parent steps around an item, outermost first; null when the plan has no such item. */
export const ancestorIds = (plan: Pick<Plan, 'items'>, id: string): string[] | null => {
    const walk = (items: readonly PlanItem[], path: string[]): string[] | null => {
        for (const item of items) {
            if (item.id === id) {
                return path;
            }
            const children = item.type === 'section' ? item.items : item.type === 'step' ? (item.steps ?? []) : [];
            const found = walk(children, [...path, item.id]);
            if (found !== null) {
                return found;
            }
        }
        return null;
    };
    return walk(plan.items, []);
};

/*
 * The view options that show one step: every fold around it opened, and the filter or Collapse done
 * let go only when they would still hide it, so a person's choice survives whenever it can.
 */
export const revealOptions = (plan: Pick<Plan, 'items'>, options: PlanViewOptions, id: string): PlanViewOptions => {
    const around = new Set(ancestorIds(plan, id) ?? []);
    const opened: PlanViewOptions = { ...options, collapsed: new Set([...options.collapsed].filter((entry) => !around.has(entry))) };
    const shows = (candidate: PlanViewOptions): boolean => planRows(plan, candidate).some((row) => row.item.id === id);
    const candidates: PlanViewOptions[] = [
        opened,
        { ...opened, filter: 'all' },
        { ...opened, collapseDone: false },
        { ...opened, filter: 'all', collapseDone: false }
    ];
    return candidates.find(shows) ?? candidates[candidates.length - 1];
};

/* What a state reads as in a plan of this kind: a test is passed, not done. */
export const stateLabel = (kind: Plan['meta']['kind'], state: PlanStepState): string => {
    if (kind === 'test') {
        return {
            open: 'Not run',
            active: 'Running',
            done: 'Passed',
            failed: 'Failed',
            skipped: 'Skipped',
            blocked: 'Blocked',
            warning: 'Warning',
            info: 'Info'
        }[state];
    }
    return { open: 'Open', active: 'Active', done: 'Done', failed: 'Failed', skipped: 'Skipped', blocked: 'Blocked', warning: 'Warning', info: 'Info' }[state];
};

/* The states a person picks from; active is the agent's word for where it works. */
export const PERSON_STATES: readonly PlanStepState[] = ['open', 'done', 'warning', 'info', 'failed', 'skipped', 'blocked'];

/* The outcomes the mark of a test step offers. */
export const TEST_OUTCOMES: readonly PlanStepState[] = ['done', 'warning', 'info', 'failed', 'skipped', 'blocked'];

/* A state that is only worth something with a line about what happened, so picking it opens the note. */
export const asksForNote = (state: PlanStepState): boolean => state === 'failed' || state === 'warning' || state === 'info';

/* A click on the mark of a step in a steps plan: done, or back to open. */
export const toggledState = (state: PlanStepState): PlanStepState => (state === 'done' ? 'open' : 'done');

const AGENT_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', copilot: 'Copilot' };

/* The short name of the agent a chat runs, as a person calls it. */
export const agentName = (provider: AgentKind | string | null | undefined): string => {
    if (!provider) {
        return 'The agent';
    }
    return AGENT_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
};

/*
 * Who set a step and when. A person's short line stays in the row; an agent's name only goes in a
 * tooltip, so a long title keeps the width of the row. An open step says nothing.
 */
export const stepSetBy = (step: Pick<PlanStep, 'by'>, state: PlanStepState, agent: string, when: string): { text: string | null; tooltip: string | null } => {
    if (state === 'open') {
        return { text: null, tooltip: null };
    }
    if (step.by === 'person') {
        return { text: when ? `you · ${when}` : 'you', tooltip: null };
    }
    if (step.by === 'agent') {
        return { text: null, tooltip: when ? `${agent} set it at ${when}` : `${agent} set it` };
    }
    return { text: null, tooltip: null };
};

/*
 * What "Send results to chat" puts in the prompt: every failed, blocked, warning and info step with
 * its note, under the plan's title. Null when there is nothing to report.
 */
export const resultsText = (plan: Plan): string | null => {
    const lines = (state: PlanStepState): string[] =>
        leavesOf(plan.items)
            .filter((step) => step.state === state)
            .map((step) => `- ${step.title}${step.note ? `: ${step.note.replace(/\s*\n\s*/g, ' ')}` : ''}`);
    const groups = (['failed', 'blocked', 'warning', 'info'] as const)
        .map((state) => ({ heading: `${stateLabel('steps', state)}:`, lines: lines(state) }))
        .filter((group) => group.lines.length > 0);
    if (groups.length === 0) {
        return null;
    }
    return [`Results of the plan "${plan.meta.title}":`, ...groups.map((group) => [group.heading, ...group.lines].join('\n'))].join('\n\n');
};

/* One step as a line of Markdown, for Copy in its menu. */
export const stepMarkdown = (kind: Plan['meta']['kind'], step: PlanStep): string => {
    const state = stepState(step);
    const mark = state === 'done' ? '[x]' : '[ ]';
    const label = state === 'open' || state === 'done' ? '' : ` (${stateLabel(kind, state).toLowerCase()})`;
    return `- ${mark} ${step.title}${label}${step.note ? `\n    > ${step.note.replace(/\n/g, '\n    > ')}` : ''}`;
};
