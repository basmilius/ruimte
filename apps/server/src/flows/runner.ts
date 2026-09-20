import { createHash, randomBytes } from 'node:crypto';
import type { FlowArgValue, FlowCard, FlowDocument, FlowEnablePayload, FlowNoticeEvent, FlowPort, FlowRun, FlowStateResult } from '@ruimte/contracts';
import {
    argApplies,
    argsOf,
    fillTokens,
    isTriggerCard,
    numberArg,
    portForOutcome,
    portsOf,
    readyCards,
    recipeFingerprint,
    settleCard,
    textArg,
    tokenKey,
    type FlowRunState
} from '@ruimte/flow';
import type { FlowTriggerEntry, OutboxStore, RunFlowEntry } from '../outbox/outbox.ts';
import type { FlowCardHandler } from './cards.ts';
import { flowKey, type FlowSwitchStore } from './switch-store.ts';
import type { FlowTimeline } from './timeline.ts';

/* A flow that starts a flow that starts a flow stops here, in the spirit of a message going one step. */
export const FLOW_MAX_DEPTH = 3;

/* Above this a flow sleeps and says so: a watch on a build folder does a thousand in ten seconds. */
export const FLOW_RUNS_PER_MINUTE = 10;

/* How late a moment may be and still count as that moment rather than as one that was missed. */
export const FLOW_MOMENT_SLACK_MS = 60_000;

const UNIT_MS: Record<string, number> = { seconds: 1_000, minutes: 60_000, hours: 3_600_000 };

export interface FlowRunnerDeps {
    /* The recipe of a flow, in a project that may be closed. */
    read(projectId: string, viewId: string): Promise<FlowDocument | null>;
    /* The name a person sees for this flow. */
    nameOf(projectId: string, viewId: string): Promise<string>;
    switches: FlowSwitchStore;
    timeline: FlowTimeline;
    outbox: OutboxStore;
    enqueue(projectId: string, target: string, work: FlowWork, notBefore?: number): Promise<void>;
    handlers: Record<string, FlowCardHandler>;
    notify(event: FlowNoticeEvent): void;
    now?(): number;
    mintId?(): string;
}

/* The two kinds of work a flow owes the outbox. */
export type FlowWork =
    | { kind: 'run-flow'; payload: { viewId: string; runId: string; resume?: string } }
    | { kind: 'flow-trigger'; payload: { viewId: string; cardId: string; due: number } };

export interface FlowTriggerFiring {
    cardId: string;
    tokens?: Record<string, FlowArgValue>;
}

/* The fingerprint of a recipe, as the switch stores it. */
export const hashRecipe = (document: FlowDocument): string => createHash('sha256').update(recipeFingerprint(document)).digest('hex');

/*
 * Runs the flows of this machine, on the outbox and nowhere else.
 *
 * Nothing here holds a timer: a wait and a moment are both an entry with a `notBefore`, so a machine
 * that sleeps through three in the morning picks up where it was rather than losing the run. One run
 * at a time per flow, ten runs a minute, and three flows deep; a moment that went by while the
 * machine was closed is gone, with a line in the timeline saying so.
 */
export class FlowRunner {
    private readonly deps: FlowRunnerDeps;
    private readonly now: () => number;
    private readonly mintId: () => string;

    constructor(deps: FlowRunnerDeps) {
        this.deps = deps;
        this.now = deps.now ?? Date.now;
        this.mintId = deps.mintId ?? (() => randomBytes(6).toString('hex'));
    }

    /* The switch and the history of one flow, which is what the editor draws beside the worksheet. */
    async state(projectId: string, viewId: string): Promise<FlowStateResult> {
        return { switch: this.deps.switches.of(projectId, viewId), runs: await this.deps.timeline.runs(projectId, viewId) };
    }

    /*
     * A person turns a flow on or off. Turning it on writes down the recipe it was turned on for, so
     * a later change to the recipe is a different flow and has to be said yes to again.
     */
    async enable(payload: FlowEnablePayload, by: string): Promise<FlowStateResult> {
        const document = await this.deps.read(payload.projectId, payload.viewId);
        if (document === null) {
            throw new Error(`No flow ${payload.viewId} in project ${payload.projectId}`);
        }
        const next = payload.enabled
            ? {
                  enabled: true,
                  enabledBy: by,
                  enabledAt: this.now(),
                  recipeHash: hashRecipe(document),
                  ...(payload.ceiling === undefined ? {} : { ceiling: payload.ceiling }),
                  ...(payload.budget === undefined ? {} : { budget: payload.budget })
              }
            : { ...this.deps.switches.of(payload.projectId, payload.viewId), enabled: false };
        await this.deps.switches.set(payload.projectId, payload.viewId, next);
        await this.arm(payload.projectId, payload.viewId);
        return this.state(payload.projectId, payload.viewId);
    }

    /*
     * Owes the moments of every time trigger of this flow, or takes them back when it is off. Called
     * at the start and after anything that could have changed either side.
     */
    async arm(projectId: string, viewId: string): Promise<void> {
        const owed = this.deps.outbox
            .list()
            .filter((entry): entry is FlowTriggerEntry => entry.kind === 'flow-trigger' && entry.projectId === projectId && entry.payload.viewId === viewId);
        const document = await this.deps.read(projectId, viewId);
        const live = document === null ? null : await this.liveRecipe(projectId, viewId, document);
        const cards = live === null ? [] : Object.entries(live.cards).filter(([, card]) => card.kind === 'trigger' && card.card === 'time.at');
        for (const entry of owed) {
            if (!cards.some(([cardId]) => cardId === entry.payload.cardId)) {
                await this.deps.outbox.remove(entry.id);
            }
        }
        for (const [cardId, card] of cards) {
            if (owed.some((entry) => entry.payload.cardId === cardId)) {
                continue;
            }
            await this.oweMoment(projectId, viewId, cardId, card);
        }
    }

    /* Arms every flow this machine was left with. */
    async armAll(): Promise<void> {
        for (const record of this.deps.switches.all()) {
            await this.arm(record.projectId, record.viewId).catch((e: unknown) => {
                console.error(`Arming flow ${record.viewId} failed:`, e instanceof Error ? e.message : e);
            });
        }
    }

    /* Every flow that is on and has a card of this kind, for the parts that have to listen somewhere. */
    async listening(cardId: string): Promise<{ projectId: string; viewId: string; cards: [string, FlowCard][] }[]> {
        const listening: { projectId: string; viewId: string; cards: [string, FlowCard][] }[] = [];
        for (const record of this.deps.switches.all()) {
            if (!record.enabled) {
                continue;
            }
            const document = await this.deps.read(record.projectId, record.viewId).catch(() => null);
            const live = document === null ? null : await this.liveRecipe(record.projectId, record.viewId, document);
            const cards = live === null ? [] : Object.entries(live.cards).filter(([, card]) => card.card === cardId);
            if (cards.length > 0) {
                listening.push({ projectId: record.projectId, viewId: record.viewId, cards });
            }
        }
        return listening;
    }

    /*
     * A trigger fired. Everything that could stop a run is here and nowhere else, and each refusal
     * leaves a line behind: a flow that did nothing has to be able to say why.
     */
    async fire(projectId: string, viewId: string, firing: FlowTriggerFiring, depth = 1): Promise<void> {
        const document = await this.deps.read(projectId, viewId);
        if (document === null || document.cards[firing.cardId] === undefined) {
            return;
        }
        if ((await this.liveRecipe(projectId, viewId, document)) === null) {
            return;
        }
        if (depth > FLOW_MAX_DEPTH) {
            await this.line(projectId, viewId, firing, 'refused', `A chain of flows stops at ${FLOW_MAX_DEPTH} deep`, depth);
            return;
        }
        if ((await this.deps.timeline.since(projectId, viewId, 60_000)) >= FLOW_RUNS_PER_MINUTE) {
            const note = `More than ${FLOW_RUNS_PER_MINUTE} runs in a minute, so this flow is sleeping it off`;
            await this.line(projectId, viewId, firing, 'skipped', note, depth);
            this.deps.notify({ projectId, viewId, flow: await this.deps.nameOf(projectId, viewId), text: note, at: this.now() });
            return;
        }
        if ((await this.deps.timeline.openRun(projectId, viewId)) !== null) {
            await this.line(projectId, viewId, firing, 'skipped', 'The run before this one is still going', depth);
            return;
        }
        const run: FlowRun = {
            id: `run-${this.mintId()}`,
            trigger: firing.cardId,
            startedAt: this.now(),
            outcome: 'running',
            depth,
            steps: [],
            settled: {},
            waiting: [],
            tokens: firing.tokens ?? {}
        };
        await this.deps.timeline.put(projectId, viewId, run);
        await this.deps.enqueue(projectId, flowKey(projectId, viewId), { kind: 'run-flow', payload: { viewId, runId: run.id } });
    }

    /*
     * Carries one run as far as it goes right now. Everything ready runs, a wait card parks the run
     * on a later entry, and a run with nothing left is closed. The outbox holds one of these per flow
     * at a time, which is what keeps two halves of one run out of each other's way.
     */
    async step(entry: RunFlowEntry): Promise<void> {
        const { projectId } = entry;
        const { viewId, runId } = entry.payload;
        const runs = await this.deps.timeline.runs(projectId, viewId);
        const run = runs.find((candidate) => candidate.id === runId);
        if (run === undefined || run.outcome !== 'running' || run.trigger === undefined) {
            return;
        }
        const document = await this.deps.read(projectId, viewId);
        if (document === null) {
            await this.close(projectId, viewId, run, 'refused', 'The flow is gone');
            return;
        }
        const flowName = await this.deps.nameOf(projectId, viewId);
        let state: FlowRunState = { entry: run.trigger, settled: { ...(run.settled ?? {}) }, running: [...(run.waiting ?? [])] };
        const steps = [...run.steps];
        const tokens: Record<string, FlowArgValue> = { ...run.tokens };
        if (entry.payload.resume !== undefined && state.running.includes(entry.payload.resume)) {
            steps.push({ cardId: entry.payload.resume, at: this.now(), port: 'done', note: 'waited' });
            state = settleCard(state, entry.payload.resume, 'done');
        }
        for (;;) {
            const ready = readyCards(document, state);
            if (ready.length === 0) {
                break;
            }
            for (const cardId of ready) {
                const card = document.cards[cardId] as FlowCard;
                if (card.kind === 'delay') {
                    /* A wait is an entry with a time on it, never a timer: a restart at 03:02 keeps it. */
                    const waitMs = Math.max(0, numberArg(card, 'amount', 0)) * (UNIT_MS[textArg(card, 'unit')] ?? (UNIT_MS.seconds as number));
                    state = { ...state, running: [...state.running, cardId] };
                    steps.push({ cardId, at: this.now(), note: `waiting ${Math.round(waitMs / 1000)} s` });
                    await this.deps.enqueue(
                        projectId,
                        flowKey(projectId, viewId),
                        { kind: 'run-flow', payload: { viewId, runId, resume: cardId } },
                        this.now() + waitMs
                    );
                    continue;
                }
                const outcome = await this.runCard({ projectId, viewId, flowName, runId, cardId, card, tokens });
                for (const [name, value] of Object.entries(outcome.tokens ?? {})) {
                    tokens[tokenKey(cardId, name)] = value;
                }
                steps.push({
                    cardId,
                    at: this.now(),
                    ...(outcome.port === null ? {} : { port: outcome.port }),
                    ...(outcome.note === undefined ? {} : { note: outcome.note })
                });
                state = settleCard(state, cardId, outcome.port);
            }
        }
        const going = { ...run, steps, settled: state.settled, waiting: state.running, tokens };
        // Parked on a wait card: the entry that wakes it is already owed, so this run is not over.
        await this.deps.timeline.put(projectId, viewId, state.running.length > 0 ? going : { ...going, outcome: 'done', endedAt: this.now() });
    }

    /* A moment a time trigger was waiting for, and the next one after it. */
    async moment(entry: FlowTriggerEntry): Promise<void> {
        const { projectId } = entry;
        const { viewId, cardId, due } = entry.payload;
        const document = await this.deps.read(projectId, viewId);
        const card = document?.cards[cardId];
        if (document === null || card === undefined || card.card !== 'time.at') {
            return;
        }
        const late = this.now() - due;
        if (late > FLOW_MOMENT_SLACK_MS) {
            // A moment is past. Catching up would be a storm of runs over a world that moved on.
            await this.line(projectId, viewId, { cardId }, 'missed', `The machine was away when ${textArg(card, 'at')} came round`, 1);
        } else {
            await this.fire(projectId, viewId, { cardId, tokens: momentTokens(cardId, new Date(due)) });
        }
        await this.oweMoment(projectId, viewId, cardId, card);
    }

    private async oweMoment(projectId: string, viewId: string, cardId: string, card: FlowCard): Promise<void> {
        const due = nextMoment(card, this.now());
        if (due === null) {
            return;
        }
        await this.deps.enqueue(projectId, `${flowKey(projectId, viewId)}#${cardId}`, { kind: 'flow-trigger', payload: { viewId, cardId, due } }, due);
    }

    /*
     * The recipe as far as it is allowed to run: null when the flow is off, and null after turning it
     * off because the recipe is not the one a person said yes to. That last part is the whole of the
     * guard against an agent, which may write a flow and may never turn one on.
     */
    private async liveRecipe(projectId: string, viewId: string, document: FlowDocument): Promise<FlowDocument | null> {
        const current = this.deps.switches.of(projectId, viewId);
        if (!current.enabled) {
            return null;
        }
        const hash = hashRecipe(document);
        if (current.recipeHash === hash) {
            return document;
        }
        await this.deps.switches.set(projectId, viewId, { ...current, enabled: false });
        const note = 'The flow changed since it was turned on, so it is off until someone says yes again';
        await this.line(projectId, viewId, {}, 'refused', note, 1);
        this.deps.notify({ projectId, viewId, flow: await this.deps.nameOf(projectId, viewId), text: note, at: this.now() });
        return null;
    }

    private async runCard(work: {
        projectId: string;
        viewId: string;
        flowName: string;
        runId: string;
        cardId: string;
        card: FlowCard;
        tokens: Readonly<Record<string, FlowArgValue>>;
    }): Promise<{ port: FlowPort | null; note?: string; tokens?: Record<string, FlowArgValue> }> {
        const { card } = work;
        // A trigger already happened, and the cards about the graph itself carry the run on as they are.
        if (isTriggerCard(card) || card.kind === 'any' || card.kind === 'all') {
            return { port: 'done' };
        }
        const handler = card.card === undefined ? undefined : this.deps.handlers[card.card];
        if (handler === undefined) {
            return { port: null, note: `This Ruimte does not know the card ${card.card ?? card.kind}` };
        }
        const text = (name: string): string => fillTokens(textArg(card, name), work.tokens);
        const missing = argsOf(card).filter((arg) => arg.optional !== true && argApplies(card, arg) && text(arg.name).trim() === '');
        if (missing.length > 0) {
            return { port: null, note: `This card is missing ${missing.map((arg) => arg.name).join(', ')}` };
        }
        let outcome;
        try {
            outcome = await handler({ ...work, text });
        } catch (e) {
            return { port: card.kind === 'action' ? errorPortOf(card) : null, note: e instanceof Error ? e.message : String(e) };
        }
        if (outcome.kind === 'answered') {
            return { port: portForOutcome(card, outcome.value), ...(outcome.note === undefined ? {} : { note: outcome.note }) };
        }
        if (outcome.kind === 'failed') {
            return { port: errorPortOf(card), note: outcome.note };
        }
        return {
            port: 'done',
            ...(outcome.note === undefined ? {} : { note: outcome.note }),
            ...(outcome.tokens === undefined ? {} : { tokens: outcome.tokens })
        };
    }

    private async close(projectId: string, viewId: string, run: FlowRun, outcome: FlowRun['outcome'], note: string): Promise<void> {
        await this.deps.timeline.put(projectId, viewId, { ...run, outcome, note, endedAt: this.now(), waiting: [] });
    }

    /* A run that never began, which is a line of its own in the timeline rather than nothing at all. */
    private async line(
        projectId: string,
        viewId: string,
        firing: { cardId?: string },
        outcome: FlowRun['outcome'],
        note: string,
        depth: number
    ): Promise<void> {
        await this.deps.timeline.put(projectId, viewId, {
            id: `run-${this.mintId()}`,
            ...(firing.cardId === undefined ? {} : { trigger: firing.cardId }),
            startedAt: this.now(),
            endedAt: this.now(),
            outcome,
            note,
            depth,
            steps: [],
            tokens: {}
        });
    }
}

/* Where a failure goes: out of the error port when the card has one, and nowhere when it has not. */
const errorPortOf = (card: FlowCard): FlowPort | null => (portsOf(card).includes('error') ? 'error' : null);

/* The tokens a moment publishes: the time it stood for and the day it fell on. */
export const momentTokens = (cardId: string, at: Date): Record<string, FlowArgValue> => ({
    [tokenKey(cardId, 'time')]: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
    [tokenKey(cardId, 'day')]: DAYS[at.getDay()] as string
});

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/*
 * When this time trigger comes round next, after `from`. Every day at a time, every weekday at a
 * time, or every so many minutes. Null for a card that says nothing this can read.
 */
export const nextMoment = (card: FlowCard, from: number): number | null => {
    const every = textArg(card, 'every');
    if (every === 'minutes') {
        const minutes = Math.max(1, Math.round(numberArg(card, 'minutes', 0)));
        return from + minutes * 60_000;
    }
    const at = /^(\d{1,2}):(\d{2})$/.exec(textArg(card, 'at'));
    if (at === null) {
        return null;
    }
    const hours = Number(at[1]);
    const minutes = Number(at[2]);
    if (hours > 23 || minutes > 59) {
        return null;
    }
    const moment = new Date(from);
    moment.setHours(hours, minutes, 0, 0);
    if (moment.getTime() <= from) {
        moment.setDate(moment.getDate() + 1);
    }
    if (every === 'weekday') {
        while (moment.getDay() === 0 || moment.getDay() === 6) {
            moment.setDate(moment.getDate() + 1);
        }
    }
    return moment.getTime();
};
