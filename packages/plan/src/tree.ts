import { PLAN_LIMITS, type Plan, type PlanChecks, type PlanItem, type PlanSection, type PlanStep, type PlanStepState } from '@ruimte/contracts';

export type PlanRefusalCode =
    | 'person-only'
    | 'set-by-person'
    | 'unlocked-by-person'
    | 'step-locked'
    | 'plan-missing-item'
    | 'plan-not-found'
    | 'op-not-allowed'
    | 'plan-not-a-step'
    | 'plan-parent-state'
    | 'plan-bad-position'
    | 'duplicate-id'
    | 'plan-too-deep'
    | 'plan-too-large'
    | 'plan-invalid'
    | 'too-many-plans';

export interface PlanRefusal {
    ok: false;
    code: PlanRefusalCode;
    message: string;
}

export const refuse = (code: PlanRefusalCode, message: string): PlanRefusal => ({ ok: false, code, message });

/* Where an item stands: the array that holds it, so an operation can splice it, and the step or section around it. */
export interface PlanLocation {
    item: PlanItem;
    siblings: PlanItem[];
    index: number;
    parent: PlanSection | PlanStep | null;
    /* How deep a step is among steps, 1 at the top or in a section; 0 for a section or a text block. */
    depth: number;
}

const childrenOf = (item: PlanItem): PlanItem[] => {
    if (item.type === 'section') {
        return item.items;
    }
    if (item.type === 'step') {
        return item.steps ?? [];
    }
    return [];
};

export const locateItem = (plan: Pick<Plan, 'items'>, id: string): PlanLocation | null => {
    const search = (siblings: PlanItem[], parent: PlanSection | PlanStep | null, depth: number): PlanLocation | null => {
        for (let index = 0; index < siblings.length; index++) {
            const item = siblings[index]!;
            const itemDepth = item.type === 'step' ? depth + 1 : 0;
            if (item.id === id) {
                return { item, siblings, index, parent, depth: itemDepth };
            }
            const found = search(childrenOf(item), item.type === 'text' ? null : item, item.type === 'step' ? itemDepth : depth);
            if (found) {
                return found;
            }
        }
        return null;
    };
    return search(plan.items, null, 0);
};

export const findItem = (plan: Pick<Plan, 'items'>, id: string): PlanItem | null => locateItem(plan, id)?.item ?? null;

/* Every item in document order, parents before their children. */
export const allItems = (items: readonly PlanItem[]): PlanItem[] => items.flatMap((item) => [item, ...allItems(childrenOf(item))]);

export const allSteps = (items: readonly PlanItem[]): PlanStep[] => allItems(items).filter((item): item is PlanStep => item.type === 'step');

export const isParentStep = (step: PlanStep): boolean => (step.steps?.length ?? 0) > 0;

/* Unlocked wins over everything: a person lifted the lock and no one puts it back. */
export const effectiveChecks = (plan: Pick<Plan, 'meta'>, step: PlanStep): PlanChecks => (step.unlocked ? 'anyone' : (step.checks ?? plan.meta.checks));

export const isFinishedOutcome = (state: PlanStepState): boolean => state === 'done' || state === 'skipped' || state === 'warning' || state === 'info';

/* A warning bubbles up so a parent does not look clean; info is only worth reading on the step itself. */
export const deriveState = (states: readonly PlanStepState[]): PlanStepState => {
    if (states.includes('failed')) {
        return 'failed';
    }
    if (states.includes('blocked')) {
        return 'blocked';
    }
    if (states.every(isFinishedOutcome)) {
        return states.includes('warning') ? 'warning' : 'done';
    }
    // A skipped step did not run, so next to open steps alone it moves nothing forward.
    if (states.some((state) => state === 'active' || state === 'done' || state === 'warning' || state === 'info')) {
        return 'active';
    }
    return 'open';
};

/* A leaf's own state, or for a parent the state its children add up to. */
export const stepState = (step: PlanStep): PlanStepState => (isParentStep(step) ? deriveState(step.steps!.map(stepState)) : (step.state ?? 'open'));

export interface PlanProgress {
    /* Leaf steps only: a parent is its children. */
    total: number;
    open: number;
    active: number;
    done: number;
    failed: number;
    skipped: number;
    blocked: number;
    warning: number;
    info: number;
    /* Steps with an outcome: done, failed, skipped, warning or info. */
    finished: number;
}

export const planProgress = (items: readonly PlanItem[]): PlanProgress => {
    const progress: PlanProgress = { total: 0, open: 0, active: 0, done: 0, failed: 0, skipped: 0, blocked: 0, warning: 0, info: 0, finished: 0 };
    for (const step of leafSteps(items)) {
        const state = step.state ?? 'open';
        progress.total++;
        progress[state]++;
        if (state === 'failed' || isFinishedOutcome(state)) {
            progress.finished++;
        }
    }
    return progress;
};

/*
 * The steps that carry a state, in document order. A step with steps under it has no state of its
 * own: it is a heading, and what it says about progress is whatever its leaves say.
 */
export const leafSteps = (items: readonly PlanItem[]): PlanStep[] => allSteps(items).filter((step) => !isParentStep(step));

export const activeStepIds = (plan: Pick<Plan, 'items'>): string[] =>
    leafSteps(plan.items)
        .filter((step) => step.state === 'active')
        .map((step) => step.id);

/* True when the item, or any step under it, carries a state a person set. */
export const holdsPersonState = (item: PlanItem): boolean =>
    allItems([item]).some((entry) => entry.type === 'step' && !isParentStep(entry) && entry.by === 'person' && entry.state !== undefined);

/* The rules of a plan the schema cannot say, because they need the whole tree. */
export const structureProblem = (plan: Pick<Plan, 'items'>): PlanRefusal | null => {
    const ids = new Set<string>();
    let count = 0;
    const walk = (items: readonly PlanItem[], depth: number, inside: 'top' | 'section' | 'step'): PlanRefusal | null => {
        for (const item of items) {
            count++;
            if (count > PLAN_LIMITS.items) {
                return refuse('plan-too-large', `A plan holds at most ${PLAN_LIMITS.items} items`);
            }
            if (ids.has(item.id)) {
                return refuse('duplicate-id', `Two items share the id "${item.id}"`);
            }
            ids.add(item.id);
            if (item.type === 'section' && inside !== 'top') {
                return refuse('plan-bad-position', `The section "${item.id}" is not at the top of the plan; sections do not nest`);
            }
            if (item.type === 'text' && inside === 'step') {
                return refuse('plan-bad-position', `The text block "${item.id}" is under a step; a step only holds steps`);
            }
            if (item.type === 'step') {
                if (depth + 1 > PLAN_LIMITS.depth) {
                    return refuse('plan-too-deep', `The step "${item.id}" is ${depth + 1} levels deep; steps go at most ${PLAN_LIMITS.depth} levels deep`);
                }
                if (isParentStep(item) && (item.state !== undefined || item.by !== undefined || item.at !== undefined)) {
                    return refuse('plan-parent-state', `The step "${item.id}" has sub-steps, so its state follows from them`);
                }
                const problem = walk(item.steps ?? [], depth + 1, 'step');
                if (problem) {
                    return problem;
                }
            }
            if (item.type === 'section') {
                const problem = walk(item.items, depth, 'section');
                if (problem) {
                    return problem;
                }
            }
        }
        return null;
    };
    return walk(plan.items, 0, 'top');
};
