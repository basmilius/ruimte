import {
    PlanChecksSchema,
    PlanItemIdSchema,
    PlanKindSchema,
    PlanMetaSchema,
    PlanOpSchema,
    PlanSchema,
    PlanSectionSchema,
    PlanStepSchema,
    PlanStepStateSchema,
    PlanTextSchema,
    type Plan,
    type PlanActor,
    type PlanItem,
    type PlanMeta,
    type PlanOp,
    type PlanSection,
    type PlanStep,
    type PlanStepState,
    type PlanText
} from '@ruimte/contracts';
import { z } from 'zod';
import { canApply } from './permissions.ts';
import { allItems, allSteps, effectiveChecks, locateItem, refuse, structureProblem, type PlanRefusal } from './tree.ts';

export interface PlanApplyOptions {
    actor: PlanActor;
    /* ISO time written into `at`; injected so a test never reads the clock. */
    now: string;
    /* Mints an id for an item that comes without one; retried until it is not taken. */
    mintId?: () => string;
}

export interface PlanApplied {
    ok: true;
    plan: Plan;
    /* Ids minted for items that came without one, in the order they were added. */
    minted: string[];
    /* Steps that got their first sub-step and so lost the state they had. */
    dropped: string[];
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const randomItemId = (): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
};

const issueMessage = (error: z.ZodError): string => {
    const issue = error.issues[0];
    if (!issue) {
        return 'The plan is not valid';
    }
    const path = issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('');
    return `${path ? `${path.replace(/^\./, '')}: ` : ''}${issue.message}`;
};

const idMinter = (taken: Set<string>, mintId: () => string, minted: string[]) => (): string => {
    for (let attempt = 0; attempt < 1000; attempt++) {
        const id = mintId();
        if (!taken.has(id)) {
            taken.add(id);
            minted.push(id);
            return id;
        }
    }
    throw new Error('Could not mint a free plan item id');
};

const setState = (step: PlanStep, state: PlanStepState, actor: PlanActor, now: string): void => {
    // An agent confirming what a person set leaves the person's mark on it.
    if (actor === 'agent' && step.by === 'person' && step.state === state) {
        return;
    }
    step.state = state;
    step.by = actor;
    step.at = now;
};

const setNote = (step: PlanStep, text: string): void => {
    if (text === '') {
        delete step.note;
    } else {
        step.note = text;
    }
};

/* The array a new or moved item goes into and where, or a refusal. */
const placeFor = (
    plan: Plan,
    type: PlanItem['type'],
    under: string | undefined,
    after: string | undefined
): { siblings: PlanItem[]; index: number; parent: PlanSection | PlanStep | null } | PlanRefusal => {
    let parent: PlanSection | PlanStep | null = null;
    let siblings: PlanItem[] = plan.items;
    if (under !== undefined) {
        const location = locateItem(plan, under);
        if (!location) {
            return refuse('plan-missing-item', `The plan has no item "${under}"`);
        }
        const target = location.item;
        if (target.type === 'text') {
            return refuse('plan-bad-position', `"${under}" is a text block, which holds no items`);
        }
        parent = target;
        if (target.type === 'section') {
            siblings = target.items;
        } else {
            target.steps ??= [];
            siblings = target.steps;
        }
    } else if (after !== undefined) {
        const location = locateItem(plan, after);
        if (!location) {
            return refuse('plan-missing-item', `The plan has no item "${after}"`);
        }
        parent = location.parent;
        siblings = location.siblings;
    }
    if (type === 'section' && parent !== null) {
        return refuse('plan-bad-position', 'A section only stands at the top of a plan');
    }
    if (type === 'text' && parent?.type === 'step') {
        return refuse('plan-bad-position', 'A step only holds steps, not a text block');
    }
    if (after === undefined) {
        return { siblings, index: siblings.length, parent };
    }
    const index = siblings.findIndex((item) => item.id === after);
    if (index === -1) {
        return refuse('plan-bad-position', `"${after}" is not directly under "${under}"`);
    }
    return { siblings, index: index + 1, parent };
};

/* A leaf that gets its first sub-step: its state now follows from its children. */
const becomeParent = (parent: PlanSection | PlanStep | null, dropped: string[]): void => {
    if (parent?.type !== 'step' || (parent.steps?.length ?? 0) !== 1) {
        return;
    }
    if (parent.state !== undefined) {
        dropped.push(parent.id);
    }
    delete parent.state;
    delete parent.by;
    delete parent.at;
};

const pruneEmptySteps = (items: readonly PlanItem[]): void => {
    for (const item of allItems(items)) {
        if (item.type === 'step' && item.steps?.length === 0) {
            delete item.steps;
        }
    }
};

const applyOne = (plan: Plan, op: PlanOp, options: PlanApplyOptions, mint: () => string, dropped: string[]): PlanRefusal | null => {
    const verdict = canApply(op, options.actor, plan);
    if (!verdict.ok) {
        return verdict;
    }
    const stepAt = (id: string): PlanStep => locateItem(plan, id)!.item as PlanStep;
    switch (op.op) {
        case 'set': {
            for (const id of op.ids) {
                const step = stepAt(id);
                setState(step, op.state, options.actor, options.now);
                if (op.note !== undefined) {
                    setNote(step, op.note);
                }
            }
            if (op.next !== undefined) {
                setState(stepAt(op.next), 'active', options.actor, options.now);
            }
            return null;
        }
        case 'note':
            setNote(stepAt(op.id), op.text);
            return null;
        case 'unlock': {
            const roots = op.ids === 'all' ? plan.items : op.ids.map((id) => stepAt(id));
            for (const step of allSteps(roots)) {
                if (effectiveChecks(plan, step) === 'agent') {
                    step.unlocked = true;
                }
            }
            return null;
        }
        case 'add': {
            const id = op.id ?? mint();
            if (op.id !== undefined && locateItem(plan, op.id)) {
                return refuse('duplicate-id', `The plan already has an item "${op.id}"`);
            }
            if (op.checks !== undefined && op.type !== 'step') {
                return refuse('plan-invalid', 'Only a step has checks');
            }
            const place = placeFor(plan, op.type, op.under, op.after);
            if ('ok' in place) {
                return place;
            }
            const base = { id, title: op.title, ...(op.description ? { description: op.description } : {}) };
            const item: PlanItem =
                op.type === 'section'
                    ? { type: 'section', ...base, items: [] }
                    : op.type === 'text'
                      ? { type: 'text', ...base }
                      : { type: 'step', ...base, ...(op.checks ? { checks: op.checks } : {}) };
            place.siblings.splice(place.index, 0, item);
            becomeParent(place.parent, dropped);
            return null;
        }
        case 'edit': {
            const item = locateItem(plan, op.id)!.item;
            if (op.checks !== undefined && item.type !== 'step') {
                return refuse('plan-invalid', 'Only a step has checks');
            }
            if (op.title !== undefined) {
                item.title = op.title;
            }
            if (op.description === '') {
                delete item.description;
            } else if (op.description !== undefined) {
                item.description = op.description;
            }
            if (op.checks !== undefined && item.type === 'step') {
                item.checks = op.checks;
            }
            return null;
        }
        case 'move': {
            const location = locateItem(plan, op.id)!;
            if (op.after === op.id || (op.under !== undefined && allItems([location.item]).some((item) => item.id === op.under))) {
                return refuse('plan-bad-position', `"${op.id}" cannot move into itself`);
            }
            location.siblings.splice(location.index, 1);
            const place = placeFor(plan, location.item.type, op.under, op.after);
            if ('ok' in place) {
                return place;
            }
            place.siblings.splice(place.index, 0, location.item);
            becomeParent(place.parent, dropped);
            return null;
        }
        case 'remove': {
            const location = locateItem(plan, op.id)!;
            location.siblings.splice(location.index, 1);
            return null;
        }
        case 'meta': {
            if (op.title !== undefined) {
                plan.meta.title = op.title;
            }
            for (const key of ['summary', 'status'] as const) {
                if (op[key] === '') {
                    delete plan.meta[key];
                } else if (op[key] !== undefined) {
                    plan.meta[key] = op[key];
                }
            }
            if (op.checks !== undefined) {
                plan.meta.checks = op.checks;
            }
            return null;
        }
    }
};

/*
 * Applies a batch of operations for one actor, all or nothing. Each operation sees the plan as the
 * ones before it left it, and the whole batch is one rev, so a step done and the next one active land
 * together.
 */
export const applyPlanOps = (plan: Plan, ops: readonly PlanOp[], options: PlanApplyOptions): PlanApplied | PlanRefusal => {
    const parsedOps = z.array(PlanOpSchema).min(1).safeParse(ops);
    if (!parsedOps.success) {
        return refuse('plan-invalid', issueMessage(parsedOps.error));
    }
    const next = structuredClone(plan);
    const minted: string[] = [];
    const dropped: string[] = [];
    const taken = new Set(allItems(next.items).map((item) => item.id));
    const mint = idMinter(taken, options.mintId ?? randomItemId, minted);
    for (const op of parsedOps.data) {
        const problem = applyOne(next, op, options, mint, dropped);
        if (problem) {
            return problem;
        }
        for (const item of allItems(next.items)) {
            taken.add(item.id);
        }
    }
    pruneEmptySteps(next.items);
    next.rev = plan.rev + 1;
    const checked = validatePlan(next);
    if (!checked.ok) {
        return checked;
    }
    return { ok: true, plan: checked.plan, minted, dropped };
};

/* A plan as it is stored or sent: the schema, then the rules that need the whole tree. */
export const validatePlan = (value: unknown): { ok: true; plan: Plan } | PlanRefusal => {
    const parsed = PlanSchema.safeParse(value);
    if (!parsed.success) {
        return refuse('plan-invalid', issueMessage(parsed.error));
    }
    const problem = structureProblem(parsed.data);
    return problem ?? { ok: true, plan: parsed.data };
};

/*
 * What an agent hands `plan new`. Strict, so a misspelled field is refused by its path instead of
 * dropped. Ids are optional and minted when absent; who set a state and when is never the agent's to say.
 */
export const PlanDraftStepSchema = z.strictObject({
    type: PlanStepSchema.shape.type,
    id: PlanItemIdSchema.optional(),
    title: PlanStepSchema.shape.title,
    description: PlanStepSchema.shape.description,
    checks: PlanStepSchema.shape.checks,
    state: PlanStepStateSchema.optional(),
    note: PlanStepSchema.shape.note,
    get steps() {
        return z.array(PlanDraftStepSchema).optional();
    }
});
export type PlanDraftStep = z.infer<typeof PlanDraftStepSchema>;

export const PlanDraftTextSchema = z.strictObject({ ...PlanTextSchema.shape, id: PlanItemIdSchema.optional() });
export type PlanDraftText = z.infer<typeof PlanDraftTextSchema>;

export const PlanDraftSectionSchema = z.strictObject({
    ...PlanSectionSchema.shape,
    id: PlanItemIdSchema.optional(),
    items: z.array(z.discriminatedUnion('type', [PlanDraftTextSchema, PlanDraftStepSchema]))
});
export type PlanDraftSection = z.infer<typeof PlanDraftSectionSchema>;

export const PlanDraftItemSchema = z.discriminatedUnion('type', [PlanDraftSectionSchema, PlanDraftTextSchema, PlanDraftStepSchema]);
export type PlanDraftItem = z.infer<typeof PlanDraftItemSchema>;

export const PlanDraftMetaSchema = z.strictObject({
    title: PlanMetaSchema.shape.title.optional(),
    kind: PlanKindSchema.optional(),
    summary: PlanMetaSchema.shape.summary,
    status: PlanMetaSchema.shape.status,
    checks: PlanChecksSchema.optional()
});
export type PlanDraftMeta = z.infer<typeof PlanDraftMetaSchema>;

export const PlanDraftSchema = z.strictObject({
    meta: PlanDraftMetaSchema.optional(),
    items: z.array(PlanDraftItemSchema)
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

export const parsePlanDraft = (value: unknown): { ok: true; draft: PlanDraft } | PlanRefusal => {
    const parsed = PlanDraftSchema.safeParse(value);
    return parsed.success ? { ok: true, draft: parsed.data } : refuse('plan-invalid', issueMessage(parsed.error));
};

export interface PlanCreateOptions {
    id: string;
    now: string;
    mintId?: () => string;
    /* What the verb's flags say; wins over the draft's own meta. */
    meta?: Partial<Pick<PlanMeta, 'title' | 'kind' | 'checks'>>;
}

/* A new plan from an agent's draft: ids minted, states marked as the agent's, and the same rules as any later change. */
export const createPlan = (draft: PlanDraft, options: PlanCreateOptions): PlanApplied | PlanRefusal => {
    const parsed = PlanDraftSchema.safeParse(draft);
    if (!parsed.success) {
        return refuse('plan-invalid', issueMessage(parsed.error));
    }
    const source = parsed.data;
    const title = options.meta?.title ?? source.meta?.title;
    if (!title) {
        return refuse('plan-invalid', 'A plan needs a title');
    }
    const meta: PlanMeta = {
        title,
        kind: options.meta?.kind ?? source.meta?.kind ?? 'steps',
        ...(source.meta?.summary ? { summary: source.meta.summary } : {}),
        ...(source.meta?.status ? { status: source.meta.status } : {}),
        checks: options.meta?.checks ?? source.meta?.checks ?? 'anyone'
    };
    const minted: string[] = [];
    const taken = new Set<string>();
    for (const item of allDraftItems(source.items)) {
        if (item.id !== undefined) {
            if (taken.has(item.id)) {
                return refuse('duplicate-id', `Two items share the id "${item.id}"`);
            }
            taken.add(item.id);
        }
    }
    const mint = idMinter(taken, options.mintId ?? randomItemId, minted);
    const described = <T extends { description?: string }>(value: T): T => {
        if (value.description === '') {
            delete value.description;
        }
        return value;
    };
    const toStep = (step: PlanDraftStep): PlanStep => {
        const { steps, state, note, ...rest } = step;
        const result: PlanStep = described({ ...rest, id: step.id ?? mint() });
        if (steps && steps.length > 0) {
            result.steps = steps.map(toStep);
        }
        if (state !== undefined) {
            Object.assign(result, { state, by: 'agent', at: options.now });
        }
        if (note) {
            result.note = note;
        }
        return result;
    };
    const toText = (text: PlanDraftText): PlanText => described({ ...text, id: text.id ?? mint() });
    const items = source.items.map((item): PlanItem => {
        if (item.type === 'section') {
            return described({ ...item, id: item.id ?? mint(), items: item.items.map((child) => (child.type === 'text' ? toText(child) : toStep(child))) });
        }
        return item.type === 'text' ? toText(item) : toStep(item);
    });
    const plan: Plan = { id: options.id, rev: 0, createdAt: options.now, meta, items };
    const checked = validatePlan(plan);
    if (!checked.ok) {
        return checked;
    }
    for (const step of allSteps(checked.plan.items)) {
        if (step.state !== undefined && effectiveChecks(checked.plan, step) === 'person') {
            return refuse('person-only', `Only a person checks "${step.id}"`);
        }
    }
    return { ok: true, plan: checked.plan, minted, dropped: [] };
};

const allDraftItems = (items: readonly PlanDraftItem[]): PlanDraftItem[] =>
    items.flatMap((item) => [item, ...allDraftItems(item.type === 'section' ? item.items : item.type === 'step' ? (item.steps ?? []) : [])]);
