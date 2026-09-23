import type { ActionActor, ActionHandlers } from '@ruimte/actions';
import type { Plan, PlanActor, PlanOp } from '@ruimte/contracts';
import { parsePlanDraft, parsePlanMarkdown, progressText, type PlanApplied, type PlanRefusal } from '@ruimte/plan';
import { callerKind } from '../canvas/tasks.ts';
import { VerbRefusal, field, orNote, type CanvasHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

const HELP_LINE = 'detail\truimte-context help plan';

/* The plan store holds a person-only step against anyone who is not a person, whoever runs the action. */
const planActorOf = (actor: ActionActor): PlanActor => (actor.kind === 'person' ? 'person' : 'agent');

/* The chat the caller is: a plan is kept beside a chat's record, and a terminal has none. */
const callerChat = async ({ host, place }: ServerActionContext, caller: string): Promise<string> => {
    const kind = callerKind(await host.read(place.projectId), caller);
    if (kind !== 'chat') {
        throw new VerbRefusal(
            'plan-needs-chat',
            `A plan belongs to a chat, and you are ${kind === null ? 'not a node of this project' : `a ${kind}`}: only a chat has a record to keep a plan beside`
        );
    }
    return caller;
};

const planRow = (plan: Plan): string => `plan\t${plan.id}\t${plan.meta.kind}\t${field(plan.meta.title)}\t${field(progressText(plan))}`;

const plansOrNote = (plans: readonly Plan[]): string[] => orNote(plans.map(planRow), 'This chat has no plan; ruimte-context plan new makes one');

/* A refusal of the store, with what the agent can do next beside it. */
const refused = async (host: CanvasHost, chatId: string, refusal: PlanRefusal): Promise<VerbRefusal> => {
    switch (refusal.code) {
        case 'plan-not-found':
            return new VerbRefusal(refusal.code, refusal.message, plansOrNote(await host.plans.read(chatId)));
        case 'too-many-plans':
            return new VerbRefusal(refusal.code, refusal.message, [
                ...(await host.plans.read(chatId)).map(planRow),
                'see\truimte-context plan delete --plan P\tremoves a plan you no longer keep'
            ]);
        case 'plan-missing-item':
        case 'plan-not-a-step':
        case 'plan-parent-state':
            return new VerbRefusal(refusal.code, refusal.message, ['see\truimte-context plan read\tevery item with its id in brackets']);
        case 'set-by-person':
            return new VerbRefusal(refusal.code, refusal.message, [
                'see\truimte-context plan note <stepId> --text T\ta note is always yours to add; or ask the person in the chat'
            ]);
        case 'plan-invalid':
            return new VerbRefusal(refusal.code, refusal.message, [HELP_LINE]);
        default:
            return new VerbRefusal(refusal.code, refusal.message);
    }
};

/* Operations of the caller on its own plan, all or nothing, or the store's refusal with what to do instead. */
const applyOps = async (actor: ActionActor, context: ServerActionContext, planId: string | null, ops: PlanOp[]): Promise<PlanApplied> => {
    const chatId = await callerChat(context, actor.id);
    const applied = await context.host.plans.apply(chatId, planId ?? undefined, ops, planActorOf(actor));
    if (!applied.ok) {
        throw await refused(context.host, chatId, applied);
    }
    return applied;
};

const changed = (applied: PlanApplied) => ({ output: { plan: applied.plan, dropped: applied.dropped } });

const parseJson = (source: string): unknown => {
    try {
        return JSON.parse(source);
    } catch (e) {
        throw new VerbRefusal('bad-json', `The document is not JSON: ${e instanceof Error ? e.message : 'it does not parse'}`, [HELP_LINE]);
    }
};

export const planActions: ActionHandlers<ServerActionContext> = {
    'plan.list': async (_input, { actor, context }) => ({
        output: { plans: await context.host.plans.read(await callerChat(context, actor.id)) }
    }),
    'plan.read': async ({ planId }, { actor, context }) => {
        const plans = await context.host.plans.read(await callerChat(context, actor.id));
        if (plans.length === 0) {
            return { output: { plan: null, others: [] } };
        }
        const plan = planId === null ? plans.at(-1)! : plans.find((candidate) => candidate.id === planId);
        if (!plan) {
            throw new VerbRefusal('plan-not-found', `This chat has no plan ${planId}`, plansOrNote(plans));
        }
        return { output: { plan, others: plans.filter((other) => other !== plan) } };
    },
    'plan.create': async ({ document, markdown, title, kind, checks }, { actor, context, dryRun }) => {
        const chatId = await callerChat(context, actor.id);
        if (document !== null && markdown !== null) {
            throw new VerbRefusal('two-documents', 'plan new takes the JSON document or --markdown, not both', [HELP_LINE]);
        }
        const source = markdown ?? document ?? '';
        if (source.trim() === '') {
            throw new VerbRefusal(
                'no-document',
                "plan new reads the plan on stdin and got nothing: ruimte-context plan new <<'EOF' {...} EOF, or ruimte-context plan new --markdown - <<'EOF' ... EOF",
                [HELP_LINE]
            );
        }
        const parsed = markdown === null ? parsePlanDraft(parseJson(source)) : parsePlanMarkdown(source);
        if (!parsed.ok) {
            throw await refused(context.host, chatId, parsed);
        }
        const meta = {
            ...(title ? { title } : {}),
            ...(kind ? { kind } : {}),
            ...(checks ? { checks } : {})
        };
        const created = await context.host.plans.create(chatId, { draft: parsed.draft, meta, dryRun: dryRun === true });
        if (!created.ok) {
            throw await refused(context.host, chatId, created);
        }
        return { output: { plan: created.plan } };
    },
    'plan.setStepState': async ({ planId, stepIds, state, note, next }, { actor, context }) =>
        changed(
            await applyOps(actor, context, planId, [{ op: 'set', ids: stepIds, state, ...(note === null ? {} : { note }), ...(next === null ? {} : { next }) }])
        ),
    'plan.addNote': async ({ planId, stepId, text }, { actor, context }) => changed(await applyOps(actor, context, planId, [{ op: 'note', id: stepId, text }])),
    'plan.addItem': async ({ planId, type, title, description, under, after, checks, itemId }, { actor, context }) => {
        const applied = await applyOps(actor, context, planId, [
            {
                op: 'add',
                type,
                title,
                ...(description === null ? {} : { description }),
                ...(under === null ? {} : { under }),
                ...(after === null ? {} : { after }),
                ...(checks === null ? {} : { checks }),
                ...(itemId === null ? {} : { id: itemId })
            }
        ]);
        return { output: { plan: applied.plan, dropped: applied.dropped, itemId: itemId ?? applied.minted[0]! } };
    },
    'plan.editItem': async ({ planId, itemId, title, description, checks }, { actor, context }) => {
        if (title === null && description === null && checks === null) {
            throw new VerbRefusal('nothing-to-edit', 'plan edit needs at least one of --title, --description and --checks');
        }
        return changed(
            await applyOps(actor, context, planId, [
                {
                    op: 'edit',
                    id: itemId,
                    ...(title === null ? {} : { title }),
                    ...(description === null ? {} : { description }),
                    ...(checks === null ? {} : { checks })
                }
            ])
        );
    },
    'plan.moveItem': async ({ planId, itemId, under, after }, { actor, context }) =>
        changed(
            await applyOps(actor, context, planId, [{ op: 'move', id: itemId, ...(under === null ? {} : { under }), ...(after === null ? {} : { after }) }])
        ),
    'plan.removeItem': async ({ planId, itemId }, { actor, context }) => changed(await applyOps(actor, context, planId, [{ op: 'remove', id: itemId }])),
    'plan.setStatus': async ({ planId, text }, { actor, context }) => changed(await applyOps(actor, context, planId, [{ op: 'meta', status: text }])),
    'plan.delete': async ({ planId }, { actor, context }) => {
        const chatId = await callerChat(context, actor.id);
        const deleted = await context.host.plans.delete(chatId, planId);
        if (!deleted.ok) {
            throw await refused(context.host, chatId, deleted);
        }
        return { output: { planId: deleted.plan.id, title: deleted.plan.meta.title } };
    }
};
