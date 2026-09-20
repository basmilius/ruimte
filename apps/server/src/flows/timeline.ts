import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FlowRunSchema, type FlowRun } from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import { KeyedSerializer } from '../serializer.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { flowKey } from './switch-store.ts';

const FlowTimelineFileSchema = z.object({ version: z.literal(1), runs: z.array(FlowRunSchema) });

/* How much of a flow's past is worth keeping: enough to see a pattern, not enough to fill a disk. */
export const FLOW_RUN_LIMIT = 100;
export const FLOW_RUN_DAYS = 7;

export interface FlowTimelineOptions {
    now?: () => number;
    /* Everything about flows goes out over one channel, which this is the near end of. */
    emit?: (event: SessionEvent) => void;
}

/*
 * What every flow did, one file per flow under `$RUIMTE_HOME/flow-runs`, newest first.
 *
 * It is here from the first version on purpose. An automation that did nothing and cannot say why is
 * an automation a person turns off after two weeks, and every other thing this feature wants to do
 * later (run it again with the tokens of last night, test from halfway down) reads out of here.
 */
export class FlowTimeline {
    readonly dir: string;
    private readonly now: () => number;
    // One write at a time per flow; two flows never wait on each other.
    private readonly writes = new KeyedSerializer();
    private readonly emit: (event: SessionEvent) => void;

    constructor(home: string, options: FlowTimelineOptions = {}) {
        this.dir = join(home, 'flow-runs');
        this.now = options.now ?? Date.now;
        this.emit = options.emit ?? (() => undefined);
    }

    /* The runs of one flow, newest first, after any write still on its way. */
    runs(projectId: string, viewId: string): Promise<FlowRun[]> {
        return this.writes.run(flowKey(projectId, viewId), () => this.read(projectId, viewId));
    }

    /* The run of this flow that is still going, or null. One run at a time hangs on this. */
    async openRun(projectId: string, viewId: string): Promise<FlowRun | null> {
        return (await this.runs(projectId, viewId)).find((run) => run.outcome === 'running') ?? null;
    }

    /* How many runs of this flow began in the last stretch, which is what the speed brake counts. */
    async since(projectId: string, viewId: string, ms: number): Promise<number> {
        const floor = this.now() - ms;
        return (await this.runs(projectId, viewId)).filter((run) => run.startedAt >= floor).length;
    }

    /* Writes a run down, or writes over the one with its id, and tells whoever is watching. */
    put(projectId: string, viewId: string, run: FlowRun): Promise<void> {
        return this.writes.run(flowKey(projectId, viewId), async () => {
            const runs = await this.read(projectId, viewId);
            const next = [run, ...runs.filter((other) => other.id !== run.id)].sort((one, other) => other.startedAt - one.startedAt);
            await this.write(projectId, viewId, this.kept(next));
            this.emit({ event: 'flow.run', payload: { projectId, viewId, run } });
        });
    }

    private kept(runs: readonly FlowRun[]): FlowRun[] {
        const floor = this.now() - FLOW_RUN_DAYS * 24 * 60 * 60 * 1000;
        return runs.filter((run) => run.startedAt >= floor).slice(0, FLOW_RUN_LIMIT);
    }

    private async read(projectId: string, viewId: string): Promise<FlowRun[]> {
        let raw: string;
        try {
            raw = await readFile(this.pathOf(projectId, viewId), 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return [];
            }
            throw e;
        }
        // A history that will not parse is worth less than the run about to be written, so it starts over.
        const parsed = FlowTimelineFileSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data.runs : [];
    }

    private async write(projectId: string, viewId: string, runs: readonly FlowRun[]): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(this.pathOf(projectId, viewId), JSON.stringify({ version: 1, runs }));
    }

    private pathOf(projectId: string, viewId: string): string {
        return join(this.dir, `${encodeURIComponent(flowKey(projectId, viewId))}.json`);
    }
}
