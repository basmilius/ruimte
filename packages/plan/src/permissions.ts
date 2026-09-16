import type { Plan, PlanActor, PlanOp, PlanStep, PlanStepState } from '@ruimte/contracts';
import { allSteps, effectiveChecks, holdsPersonState, isParentStep, locateItem, refuse, type PlanRefusal } from './tree.ts';

export type PlanVerdict = { ok: true } | PlanRefusal;

const ALLOWED: PlanVerdict = { ok: true };

const PERSON_OPS: ReadonlySet<PlanOp['op']> = new Set(['set', 'note', 'unlock']);
const AGENT_OPS: ReadonlySet<PlanOp['op']> = new Set(['set', 'note', 'add', 'edit', 'move', 'remove', 'meta']);

const stepFor = (plan: Plan, id: string, leaf: boolean): PlanStep | PlanRefusal => {
    const location = locateItem(plan, id);
    if (!location) {
        return refuse('plan-missing-item', `The plan has no item "${id}"`);
    }
    if (location.item.type !== 'step') {
        return refuse('plan-not-a-step', `"${id}" is a ${location.item.type}, not a step`);
    }
    if (leaf && isParentStep(location.item)) {
        return refuse('plan-parent-state', `The step "${id}" has sub-steps, so its state follows from them`);
    }
    return location.item;
};

const mayState = (plan: Plan, step: PlanStep, state: PlanStepState, actor: PlanActor): PlanVerdict => {
    const checks = effectiveChecks(plan, step);
    if (actor === 'person') {
        return checks === 'agent' ? refuse('step-locked', `Only the agent checks "${step.id}" until a person unlocks it`) : ALLOWED;
    }
    if (checks === 'person') {
        return refuse('person-only', `Only a person checks "${step.id}"`);
    }
    if (step.by === 'person' && step.state !== undefined && step.state !== state) {
        return refuse('set-by-person', `A person set "${step.id}" to ${step.state}; add a note or ask in the chat instead`);
    }
    return ALLOWED;
};

/* Adding under a leaf takes its state away, which may not happen to a state a person set. */
const mayHoldChildren = (plan: Plan, under: string | undefined): PlanVerdict => {
    if (under === undefined) {
        return ALLOWED;
    }
    const location = locateItem(plan, under);
    if (location?.item.type === 'step' && !isParentStep(location.item) && holdsPersonState(location.item)) {
        return refuse('set-by-person', `A person set "${under}" to ${location.item.state}; a sub-step would take that state away`);
    }
    return ALLOWED;
};

/*
 * Whether this actor may apply the operation to the plan as it is now: who sets which step, what a
 * person set, what a person unlocked. The shape of the result (depth, size, positions) is checked
 * when the operation is applied.
 */
export const canApply = (op: PlanOp, actor: PlanActor, plan: Plan): PlanVerdict => {
    if (!(actor === 'person' ? PERSON_OPS : AGENT_OPS).has(op.op)) {
        return refuse('op-not-allowed', actor === 'person' ? `A person cannot ${op.op} in a plan` : `An agent cannot ${op.op} a plan`);
    }
    switch (op.op) {
        case 'set': {
            if (op.next !== undefined && actor === 'person') {
                return refuse('op-not-allowed', 'Only the agent moves on to a next step');
            }
            const targets: [string, PlanStepState][] = op.ids.map((id) => [id, op.state]);
            if (op.next !== undefined) {
                targets.push([op.next, 'active']);
            }
            for (const [id, state] of targets) {
                const step = stepFor(plan, id, true);
                if ('ok' in step) {
                    return step;
                }
                const verdict = mayState(plan, step, state, actor);
                if (!verdict.ok) {
                    return verdict;
                }
            }
            return ALLOWED;
        }
        case 'note': {
            const step = stepFor(plan, op.id, false);
            return 'ok' in step ? step : ALLOWED;
        }
        case 'unlock': {
            if (op.ids === 'all') {
                return ALLOWED;
            }
            for (const id of op.ids) {
                const step = stepFor(plan, id, false);
                if ('ok' in step) {
                    return step;
                }
            }
            return ALLOWED;
        }
        case 'add':
            return mayHoldChildren(plan, op.under);
        case 'edit': {
            const location = locateItem(plan, op.id);
            if (!location) {
                return refuse('plan-missing-item', `The plan has no item "${op.id}"`);
            }
            const item = location.item;
            if (op.checks === undefined || item.type !== 'step') {
                return ALLOWED;
            }
            if (item.unlocked && op.checks !== 'anyone') {
                return refuse('unlocked-by-person', `A person unlocked "${op.id}", so anyone checks it`);
            }
            if (effectiveChecks(plan, item) === 'person' && op.checks !== 'person') {
                return refuse('person-only', `Only a person checks "${op.id}", and that stays so`);
            }
            return ALLOWED;
        }
        case 'move': {
            if (!locateItem(plan, op.id)) {
                return refuse('plan-missing-item', `The plan has no item "${op.id}"`);
            }
            return mayHoldChildren(plan, op.under);
        }
        case 'remove': {
            const location = locateItem(plan, op.id);
            if (!location) {
                return refuse('plan-missing-item', `The plan has no item "${op.id}"`);
            }
            if (holdsPersonState(location.item)) {
                return refuse('set-by-person', `A person checked "${op.id}" or a step under it, so it stays`);
            }
            return ALLOWED;
        }
        case 'meta': {
            const inherits = allSteps(plan.items).some((step) => step.checks === undefined && !step.unlocked);
            if (op.checks !== undefined && op.checks !== 'person' && plan.meta.checks === 'person' && inherits) {
                return refuse('person-only', 'Only a person checks the steps of this plan, and that stays so');
            }
            return ALLOWED;
        }
    }
};
