import { createHash, randomBytes } from 'node:crypto';
import type {
    FlowArgValue,
    FlowArmPayload,
    FlowCard,
    FlowDocument,
    FlowEnablePayload,
    FlowNoticeEvent,
    FlowPort,
    FlowRun,
    FlowRunStep,
    FlowRunTest,
    FlowStartPayload,
    FlowStateResult,
    FlowStepEvent,
    FlowTestPayload
} from '@ruimte/contracts';
import {
    argApplies,
    argsOf,
    cardsInTest,
    fillTokens,
    isTriggerCard,
    needsCeiling,
    numberArg,
    portForOutcome,
    portsOf,
    readyCards,
    recipeFingerprint,
    runsForReal,
    settleCard,
    skippedWhenDry,
    textArg,
    tokenKey,
    type FlowRunState
} from '@ruimte/flow';
import type { FlowTriggerEntry, OutboxStore, RunFlowEntry } from '../outbox/outbox.ts';
import type { FlowArmStore } from './arm-store.ts';
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
    armed: FlowArmStore;
    timeline: FlowTimeline;
    outbox: OutboxStore;
    enqueue(projectId: string, target: string, work: FlowWork, notBefore?: number): Promise<void>;
    handlers: Record<string, FlowCardHandler>;
    notify(event: FlowNoticeEvent): void;
    /* One card of a run, the moment it settled, which is what makes the worksheet light up. */
    step(event: FlowStepEvent): void;
    /*
     * Everything that listens outside the outbox, looked at again. A flow that is off with a test
     * waiting on it still watches a folder, so what the daemon listens for changes without the
     * switch changing.
     */
    listens?(): Promise<void>;
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

/* What a run needs to begin, whether a trigger brought it or a person did. */
interface FlowRunStart {
    projectId: string;
    viewId: string;
    document: FlowDocument;
    /* The card the run begins at: a trigger, or any card on the worksheet when a person is testing. */
    cardId: string;
    tokens: Record<string, FlowArgValue>;
    depth: number;
    /* Nothing this run does leaves the machine, beyond the cards the catalog calls harmless. */
    dry: boolean;
    test?: FlowRunTest;
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
        const armed = this.deps.armed.of(projectId, viewId);
        return {
            switch: this.deps.switches.of(projectId, viewId),
            runs: await this.deps.timeline.runs(projectId, viewId),
            ...(armed === null ? {} : { armed })
        };
    }

    /*
     * A person turns a flow on or off. Turning it on writes down the recipe it was turned on for, so
     * a later change to the recipe is a different flow and has to be said yes to again. Watching is a
     * third state beside those two: it fires on its triggers and carries nothing out.
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
                  ...(payload.watching === undefined ? {} : { watching: payload.watching }),
                  ...(payload.ceiling === undefined ? {} : { ceiling: payload.ceiling }),
                  ...(payload.budget === undefined ? {} : { budget: payload.budget })
              }
            : { ...this.deps.switches.of(payload.projectId, payload.viewId), enabled: false };
        await this.deps.switches.set(payload.projectId, payload.viewId, next);
        await this.arm(payload.projectId, payload.viewId);
        return this.state(payload.projectId, payload.viewId);
    }

    /*
     * A person puts a test on the next real firing, or takes the one waiting back. This is the answer
     * to where the tokens of the cards above a test come from: not made up, but the ones the trigger
     * brings. The flow itself stays as it was, on or off.
     */
    async armTest(payload: FlowArmPayload, by: string): Promise<FlowStateResult> {
        const document = await this.deps.read(payload.projectId, payload.viewId);
        if (document === null) {
            throw new Error(`No flow ${payload.viewId} in project ${payload.projectId}`);
        }
        if (payload.test === null) {
            await this.deps.armed.clear(payload.projectId, payload.viewId);
        } else {
            if (document.cards[payload.test.from] === undefined) {
                throw new Error(`No card ${payload.test.from} on flow ${payload.viewId}`);
            }
            await this.deps.armed.set(payload.projectId, payload.viewId, { ...payload.test, by, armedAt: this.now() });
        }
        await this.arm(payload.projectId, payload.viewId);
        await this.deps.listens?.();
        return this.state(payload.projectId, payload.viewId);
    }

    /*
     * Owes the moments of every time trigger of this flow, or takes them back when nothing listens
     * for them any more. Called at the start and after anything that could have changed either side.
     */
    async arm(projectId: string, viewId: string): Promise<void> {
        const owed = this.deps.outbox
            .list()
            .filter((entry): entry is FlowTriggerEntry => entry.kind === 'flow-trigger' && entry.projectId === projectId && entry.payload.viewId === viewId);
        const document = await this.deps.read(projectId, viewId);
        const live = document === null ? null : await this.listeningRecipe(projectId, viewId, document);
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
        for (const flow of this.watched()) {
            await this.arm(flow.projectId, flow.viewId).catch((e: unknown) => {
                console.error(`Arming flow ${flow.viewId} failed:`, e instanceof Error ? e.message : e);
            });
        }
    }

    /* Every flow that listens and has a card of this kind, for the parts that have to listen somewhere. */
    async listening(cardId: string): Promise<{ projectId: string; viewId: string; cards: [string, FlowCard][] }[]> {
        const listening: { projectId: string; viewId: string; cards: [string, FlowCard][] }[] = [];
        for (const flow of this.watched()) {
            const document = await this.deps.read(flow.projectId, flow.viewId).catch(() => null);
            const live = document === null ? null : await this.listeningRecipe(flow.projectId, flow.viewId, document);
            const cards = live === null ? [] : Object.entries(live.cards).filter(([, card]) => card.card === cardId);
            if (cards.length > 0) {
                listening.push({ projectId: flow.projectId, viewId: flow.viewId, cards });
            }
        }
        return listening;
    }

    /*
     * A trigger fired. Everything that could stop a run is here and nowhere else, and each refusal
     * leaves a line behind: a flow that did nothing has to be able to say why.
     */
    async fire(projectId: string, viewId: string, firing: FlowTriggerFiring, depth = 1): Promise<FlowRun | null> {
        const document = await this.deps.read(projectId, viewId);
        if (document === null || document.cards[firing.cardId] === undefined) {
            return null;
        }
        const armed = this.deps.armed.of(projectId, viewId);
        if (armed !== null && document.cards[armed.from] !== undefined) {
            // One shot, spent the moment it is used, whether the test it starts gets as far as a run or not.
            await this.deps.armed.clear(projectId, viewId);
            await this.deps.listens?.();
            return this.begin({
                projectId,
                viewId,
                document,
                cardId: armed.from,
                tokens: firing.tokens ?? {},
                depth: 1,
                dry: armed.dry,
                test: { from: armed.from, scope: armed.scope, ...(armed.by === undefined ? {} : { by: armed.by }) }
            });
        }
        if ((await this.liveRecipe(projectId, viewId, document)) === null) {
            return null;
        }
        return this.begin({
            projectId,
            viewId,
            document,
            cardId: firing.cardId,
            tokens: firing.tokens ?? {},
            depth,
            dry: this.deps.switches.of(projectId, viewId).watching === true
        });
    }

    /*
     * A person runs the flow now, without waiting for a trigger to come round. It is the real thing:
     * the same guards as a firing, the switch included, so a flow that is off cannot be run this way.
     * Trying an off flow is what a test is for. Who pressed it is not written down: a run by hand is
     * the flow doing its own work, and the timeline has nowhere to put a person on one.
     */
    async start(payload: FlowStartPayload): Promise<FlowRun | null> {
        const { projectId, viewId, cardId } = payload;
        const document = await this.deps.read(projectId, viewId);
        const card = document?.cards[cardId];
        if (document === null || card === undefined) {
            throw new Error(`No card ${cardId} on flow ${viewId}`);
        }
        if (!isTriggerCard(card)) {
            throw new Error(`The card ${cardId} is not one a run can begin at`);
        }
        if ((await this.liveRecipe(projectId, viewId, document)) === null) {
            return null;
        }
        return this.begin({
            projectId,
            viewId,
            document,
            cardId,
            // The trigger did not happen, so what it would have published is filled in where that is free.
            tokens: card.card === 'time.at' ? momentTokens(cardId, new Date(this.now())) : {},
            depth: 1,
            dry: this.deps.switches.of(projectId, viewId).watching === true
        });
    }

    /*
     * A person tries the flow out, from any card on the worksheet. The switch is not asked: building
     * a flow, trying it and only then turning it on is the order this feature is for.
     */
    async test(payload: FlowTestPayload, by: string): Promise<FlowRun | null> {
        const { projectId, viewId, from, scope } = payload;
        const document = await this.deps.read(projectId, viewId);
        if (document === null || document.cards[from] === undefined) {
            throw new Error(`No card ${from} on flow ${viewId}`);
        }
        return this.begin({
            projectId,
            viewId,
            document,
            cardId: from,
            tokens: payload.tokens ?? {},
            depth: 1,
            dry: payload.dry,
            test: { from, scope, by }
        });
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
        const dry = run.dry === true;
        const test = run.test !== undefined;
        // One card and no lines: the only card this run may ever hand out is the one it began at.
        const only = run.test?.scope === 'card' ? run.test.from : null;
        let state: FlowRunState = { entry: run.trigger, settled: { ...(run.settled ?? {}) }, running: [...(run.waiting ?? [])] };
        const steps = [...run.steps];
        const tokens: Record<string, FlowArgValue> = { ...run.tokens };
        const wrote = (step: FlowRunStep): void => {
            steps.push(step);
            this.deps.step({ projectId, viewId, runId, step, settled: state.settled, waiting: state.running });
        };
        if (entry.payload.resume !== undefined && state.running.includes(entry.payload.resume)) {
            const resumed = entry.payload.resume;
            state = settleCard(state, resumed, 'done');
            wrote({ cardId: resumed, at: this.now(), port: 'done', note: 'waited' });
        }
        for (;;) {
            const ready = readyCards(document, state).filter((cardId) => only === null || cardId === only);
            if (ready.length === 0) {
                break;
            }
            for (const cardId of ready) {
                const card = document.cards[cardId] as FlowCard;
                if (skippedWhenDry(card, dry)) {
                    const note = card.kind === 'delay' ? `would have waited ${Math.round(waitMsOf(card) / 1000)} s` : 'walked past in a dry run';
                    state = settleCard(state, cardId, 'done');
                    wrote({ cardId, at: this.now(), port: 'done', note, dry: true });
                    continue;
                }
                if (card.kind === 'delay') {
                    /* A wait is an entry with a time on it, never a timer: a restart at 03:02 keeps it. */
                    const waitMs = waitMsOf(card);
                    state = { ...state, running: [...state.running, cardId] };
                    wrote({ cardId, at: this.now(), note: `waiting ${Math.round(waitMs / 1000)} s` });
                    await this.deps.enqueue(
                        projectId,
                        flowKey(projectId, viewId),
                        { kind: 'run-flow', payload: { viewId, runId, resume: cardId } },
                        this.now() + waitMs
                    );
                    continue;
                }
                const outcome = await this.runCard({ projectId, viewId, flowName, runId, cardId, card, tokens, dry, test });
                for (const [name, value] of Object.entries(outcome.tokens ?? {})) {
                    tokens[tokenKey(cardId, name)] = value;
                }
                state = settleCard(state, cardId, outcome.port);
                wrote({
                    cardId,
                    at: this.now(),
                    ...(outcome.port === null ? {} : { port: outcome.port }),
                    ...(outcome.note === undefined ? {} : { note: outcome.note }),
                    ...(outcome.dry === undefined ? {} : { dry: outcome.dry })
                });
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
     * Writes a run down and hands it to the outbox, once everything that could stop it had its say.
     * Both ways into a run come through here, so a test cannot be the way round a guard.
     */
    private async begin(work: FlowRunStart): Promise<FlowRun | null> {
        const { projectId, viewId, depth, test } = work;
        const marks = { ...(work.dry ? { dry: true as const } : {}), ...(test === undefined ? {} : { test }) };
        if (depth > FLOW_MAX_DEPTH) {
            await this.line(projectId, viewId, { cardId: work.cardId }, 'refused', `A chain of flows stops at ${FLOW_MAX_DEPTH} deep`, depth, marks);
            return null;
        }
        if (test !== undefined && !work.dry && this.deps.switches.of(projectId, viewId).ceiling === undefined && this.actsForSomeone(work)) {
            const note = 'A real test of a card that acts on your behalf asks for the mode ceiling, the same as turning this flow on does';
            await this.line(projectId, viewId, { cardId: work.cardId }, 'refused', note, depth, marks);
            return null;
        }
        /*
         * A test counts here like any other run: twenty tests that each ask a model is money. The
         * budget on the switch is the other half of that sentence and nothing reads it yet, so this
         * is the whole of the brake until the card that spends something arrives.
         */
        if ((await this.deps.timeline.since(projectId, viewId, 60_000)) >= FLOW_RUNS_PER_MINUTE) {
            const note = `More than ${FLOW_RUNS_PER_MINUTE} runs in a minute, so this flow is sleeping it off`;
            await this.line(projectId, viewId, { cardId: work.cardId }, 'skipped', note, depth, marks);
            this.deps.notify({ projectId, viewId, flow: await this.deps.nameOf(projectId, viewId), text: note, at: this.now() });
            return null;
        }
        if ((await this.deps.timeline.openRun(projectId, viewId)) !== null) {
            await this.line(projectId, viewId, { cardId: work.cardId }, 'skipped', 'The run before this one is still going', depth, marks);
            return null;
        }
        const run: FlowRun = {
            id: `run-${this.mintId()}`,
            trigger: work.cardId,
            startedAt: this.now(),
            outcome: 'running',
            depth,
            steps: [],
            settled: {},
            waiting: [],
            tokens: work.tokens,
            ...marks
        };
        await this.deps.timeline.put(projectId, viewId, run);
        await this.deps.enqueue(projectId, flowKey(projectId, viewId), { kind: 'run-flow', payload: { viewId, runId: run.id } });
        return run;
    }

    /*
     * Whether this test would carry out a card that acts with the permission of whoever turned the
     * flow on. No card in the catalog says so yet; the one that starts an agent is the first that
     * will, and the guard stands before it rather than after.
     */
    private actsForSomeone(work: FlowRunStart): boolean {
        if (work.test === undefined) {
            return false;
        }
        return [...cardsInTest(work.document, work.test.from, work.test.scope)].some((cardId) => {
            const card = work.document.cards[cardId];
            return card !== undefined && needsCeiling(card);
        });
    }

    /* Every flow this machine listens for: one that was turned on, and one with a test waiting on it. */
    private watched(): { projectId: string; viewId: string }[] {
        const flows = new Map<string, { projectId: string; viewId: string }>();
        for (const record of [...this.deps.switches.all(), ...this.deps.armed.all()]) {
            flows.set(flowKey(record.projectId, record.viewId), { projectId: record.projectId, viewId: record.viewId });
        }
        return [...flows.values()];
    }

    /*
     * The recipe as far as anything may act on a trigger of it: the flow is on, or a person is
     * waiting to try it. The second half is the price the armed test pays for real tokens, and it is
     * deliberately the only thing a flow that is off does.
     */
    private async listeningRecipe(projectId: string, viewId: string, document: FlowDocument): Promise<FlowDocument | null> {
        const live = await this.liveRecipe(projectId, viewId, document);
        if (live !== null) {
            return live;
        }
        const armed = this.deps.armed.of(projectId, viewId);
        // A recipe that lost the card the test starts from listens for nothing until that card is back.
        return armed !== null && document.cards[armed.from] !== undefined ? document : null;
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
        dry: boolean;
        test: boolean;
    }): Promise<{ port: FlowPort | null; note?: string; tokens?: Record<string, FlowArgValue>; dry?: true }> {
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
        if (!runsForReal(card, work.dry)) {
            // Written down with the tokens filled in, so the text of that notification can be read back.
            return { port: 'done', note: wouldDo(card, text), dry: true };
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
        depth: number,
        marks: { dry?: true; test?: FlowRunTest } = {}
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
            tokens: {},
            ...marks
        });
    }
}

/* Where a failure goes: out of the error port when the card has one, and nowhere when it has not. */
const errorPortOf = (card: FlowCard): FlowPort | null => (portsOf(card).includes('error') ? 'error' : null);

/* How long a wait card stands for. */
const waitMsOf = (card: FlowCard): number => Math.max(0, numberArg(card, 'amount', 0)) * (UNIT_MS[textArg(card, 'unit')] ?? (UNIT_MS.seconds as number));

/* What a card would have done, as the one line a person reads back after a dry run. */
const wouldDo = (card: FlowCard, text: (name: string) => string): string => {
    const fields = argsOf(card)
        .filter((arg) => argApplies(card, arg))
        .map((arg) => `${arg.name}: ${text(arg.name)}`)
        .join(', ');
    const what = card.card ?? card.kind;
    return fields === '' ? `would have run ${what}` : `would have run ${what} with ${fields}`;
};

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
