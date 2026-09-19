import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PLAN_LIMITS, PlanSchema, type Plan, type PlanActor, type PlanMeta, type PlanOfChat, type PlanOp } from '@ruimte/contracts';
import { applyPlanOps, createPlan, planProgress, randomItemId, refuse, type PlanApplied, type PlanDraft, type PlanRefusal } from '@ruimte/plan';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { ClientSinks } from '../client-sinks.ts';
import { KeyedSerializer } from '../serializer.ts';

const SUFFIX = '.plans.json';

const PlanFileSchema = z.object({ version: z.literal(1), plans: z.array(PlanSchema) });

export const planFileName = (chatId: string): string => `${encodeURIComponent(chatId)}${SUFFIX}`;

/* Whether a name in the chats folder is a plans file, which the chat records beside it must not count as a chat. */
export const isPlanFileName = (name: string): boolean => name.endsWith(SUFFIX);

export interface PlanStoreOptions {
    /* The clock `at` and `createdAt` are read from; a test hands in its own. */
    now?: () => number;
    /* Mints the ids of plans and of items that come without one. */
    mintId?: () => string;
}

export interface PlanCreateInput {
    draft: PlanDraft;
    meta?: Partial<Pick<PlanMeta, 'title' | 'kind' | 'checks'>>;
    dryRun?: boolean;
}

/*
 * The plans of every chat, one file per chat beside its record under `$RUIMTE_HOME/chats`. Not in
 * the record itself: that is rewritten on every turn and its schema strips what it does not know.
 * The daemon is the only writer, so there is no watcher, and one promise chain per chat puts a
 * person's click and an agent's verb after each other instead of beside each other.
 */
export class PlanStore {
    readonly dir: string;
    private readonly now: () => number;
    private readonly mintId: () => string;
    // One write at a time per chat; the plans of two chats never wait on each other.
    private readonly writes = new KeyedSerializer();
    private readonly sinks = new ClientSinks();

    constructor(home: string, options: PlanStoreOptions = {}) {
        this.dir = join(home, 'chats');
        this.now = options.now ?? Date.now;
        this.mintId = options.mintId ?? randomItemId;
    }

    /* Every connection hears every plan, since a chat's pill shows whether or not anyone attached the chat. */
    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* The plans of one chat, oldest first, after any write that is still on its way. */
    read(chatId: string): Promise<Plan[]> {
        return this.inChain(chatId, () => this.readFile(chatId));
    }

    /* Plans per chat, read from disk so a chat nobody loaded since the start is there too; without ids every chat that has one. */
    async list(chatIds?: readonly string[]): Promise<PlanOfChat[]> {
        const ids = chatIds ?? (await this.chatsWithPlans());
        const result: PlanOfChat[] = [];
        for (const chatId of ids) {
            const plans = await this.read(chatId).catch((e: unknown) => {
                console.error(`The plans of chat ${chatId} could not be read:`, e instanceof Error ? e.message : e);
                return [];
            });
            result.push(...plans.map((plan) => ({ chatId, plan })));
        }
        return result;
    }

    /* A new plan from an agent's draft, last in the chat's list and so the one a verb without `--plan` works on. */
    create(chatId: string, input: PlanCreateInput): Promise<PlanApplied | PlanRefusal> {
        return this.inChain(chatId, async () => {
            const plans = await this.readFile(chatId);
            if (plans.length >= PLAN_LIMITS.plansPerChat) {
                return refuse('too-many-plans', `This chat already keeps ${PLAN_LIMITS.plansPerChat} plans, which is all a chat may keep; delete one first`);
            }
            const taken = new Set(plans.map((plan) => plan.id));
            let id = `plan-${this.mintId().slice(0, 4)}`;
            while (taken.has(id)) {
                id = `plan-${this.mintId().slice(0, 6)}`;
            }
            const created = createPlan(input.draft, { id, now: this.isoNow(), mintId: this.mintId, ...(input.meta ? { meta: input.meta } : {}) });
            if (!created.ok || input.dryRun === true) {
                return created;
            }
            await this.writeFile(chatId, [...plans, created.plan]);
            // The plan first, so a client that moves its panel to the new plan already holds it.
            this.broadcast({ event: 'plan.changed', payload: { chatId, plan: created.plan } });
            this.broadcast({ event: 'plan.created', payload: { chatId, planId: created.plan.id } });
            return created;
        });
    }

    /* Operations of one actor on one plan, all or nothing on its latest rev; without a plan id the newest plan. */
    apply(chatId: string, planId: string | undefined, ops: readonly PlanOp[], actor: PlanActor): Promise<PlanApplied | PlanRefusal> {
        return this.inChain(chatId, async () => {
            const plans = await this.readFile(chatId);
            const plan = planId === undefined ? plans.at(-1) : plans.find((candidate) => candidate.id === planId);
            if (!plan) {
                return missing(planId);
            }
            const applied = applyPlanOps(plan, ops, { actor, now: this.isoNow(), mintId: this.mintId });
            if (!applied.ok) {
                return applied;
            }
            await this.writeFile(
                chatId,
                plans.map((candidate) => (candidate.id === plan.id ? applied.plan : candidate))
            );
            this.broadcast({ event: 'plan.changed', payload: { chatId, plan: applied.plan } });
            return applied;
        });
    }

    delete(chatId: string, planId: string): Promise<{ ok: true; plan: Plan } | PlanRefusal> {
        return this.inChain(chatId, async () => {
            const plans = await this.readFile(chatId);
            const plan = plans.find((candidate) => candidate.id === planId);
            if (!plan) {
                return missing(planId);
            }
            await this.writeFile(
                chatId,
                plans.filter((candidate) => candidate !== plan)
            );
            this.broadcast({ event: 'plan.removed', payload: { chatId, planId } });
            return { ok: true as const, plan };
        });
    }

    /* The plans go with the chat. A file that no longer parses goes too: nothing could ever show it again. */
    removeChat(chatId: string): Promise<void> {
        return this.inChain(chatId, async () => {
            const plans = await this.readFile(chatId).catch(() => []);
            await rm(join(this.dir, planFileName(chatId)), { force: true });
            for (const plan of plans) {
                this.broadcast({ event: 'plan.removed', payload: { chatId, planId: plan.id } });
            }
        });
    }

    /* A fork starts with the plans as they are, states, marks and locks included, and goes its own way from there. */
    async copyChat(fromChatId: string, toChatId: string): Promise<void> {
        const plans = await this.read(fromChatId);
        if (plans.length === 0) {
            return;
        }
        await this.inChain(toChatId, async () => {
            await this.writeFile(toChatId, plans);
            for (const plan of plans) {
                this.broadcast({ event: 'plan.changed', payload: { chatId: toChatId, plan } });
            }
        });
    }

    /* Whether a plan of the chat still has a step without an outcome, which is what a resumed agent should hear about. */
    async hasOpenSteps(chatId: string): Promise<boolean> {
        const plans = await this.read(chatId);
        return plans.some((plan) => {
            const progress = planProgress(plan.items);
            return progress.finished < progress.total;
        });
    }

    private async chatsWithPlans(): Promise<string[]> {
        let names: string[];
        try {
            names = await readdir(this.dir);
        } catch (e) {
            if (isNotFound(e)) {
                return [];
            }
            throw e;
        }
        return names.filter(isPlanFileName).map((name) => decodeURIComponent(name.slice(0, -SUFFIX.length)));
    }

    private async readFile(chatId: string): Promise<Plan[]> {
        let raw: string;
        try {
            raw = await readFile(join(this.dir, planFileName(chatId)), 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return [];
            }
            throw e;
        }
        // A file that does not parse is refused rather than read as empty, which the next write would make true.
        const parsed = PlanFileSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            throw new Error(`The plans file of chat ${chatId} is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`);
        }
        return parsed.data.plans;
    }

    private async writeFile(chatId: string, plans: readonly Plan[]): Promise<void> {
        const path = join(this.dir, planFileName(chatId));
        if (plans.length === 0) {
            await rm(path, { force: true });
            return;
        }
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(path, JSON.stringify({ version: 1, plans }));
    }

    private inChain<T>(chatId: string, work: () => Promise<T>): Promise<T> {
        return this.writes.run(chatId, work);
    }

    private isoNow(): string {
        return new Date(this.now()).toISOString();
    }

    private broadcast(event: SessionEvent): void {
        this.sinks.emit(event);
    }
}

const missing = (planId: string | undefined): PlanRefusal =>
    planId === undefined ? refuse('plan-not-found', 'This chat has no plan yet') : refuse('plan-not-found', `This chat has no plan ${planId}`);
