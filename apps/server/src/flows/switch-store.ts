import { join } from 'node:path';
import { FlowSwitchSchema, type FlowSwitch } from '@ruimte/contracts';
import { z } from 'zod';
import { RecordDirectory } from '../record-directory.ts';
import type { SessionEvent } from '../sessions/manager.ts';

const FlowSwitchRecordSchema = FlowSwitchSchema.extend({
    /* `<projectId>:<viewId>`, which is what makes the file name. Both parts are fields as well. */
    id: z.string().min(1),
    projectId: z.string().min(1),
    viewId: z.string().min(1)
});
export type FlowSwitchRecord = z.infer<typeof FlowSwitchRecordSchema>;

export const flowKey = (projectId: string, viewId: string): string => `${projectId}:${viewId}`;

/* What a flow nobody ever turned on amounts to. */
export const FLOW_OFF: FlowSwitch = { enabled: false };

/*
 * Whether a flow runs on this machine, one file per flow under `$RUIMTE_HOME/flows`.
 *
 * Deliberately not in the recipe. The recipe is content: it travels, it goes into git and an agent
 * may write it. This is a person saying yes, here, to the recipe that stood there at that moment,
 * which is what the fingerprint on it is for.
 */
export class FlowSwitchStore {
    readonly dir: string;
    private readonly records: RecordDirectory<FlowSwitchRecord>;
    private readonly emit: (event: SessionEvent) => void;

    /* Everything about flows goes out over one channel, which `emit` is the near end of. */
    constructor(home: string, emit: (event: SessionEvent) => void = () => undefined) {
        this.dir = join(home, 'flows');
        this.emit = emit;
        this.records = new RecordDirectory({ dir: this.dir, schema: FlowSwitchRecordSchema, idOf: (record) => record.id });
    }

    /* Reads what this machine was left set to. Call before anything can arm a flow. */
    load(): Promise<void> {
        return this.records.load();
    }

    of(projectId: string, viewId: string): FlowSwitch {
        const record = this.records.get(flowKey(projectId, viewId));
        return record === undefined ? FLOW_OFF : switchOf(record);
    }

    /* Every flow this machine has a word on, including the ones that were turned off again. */
    all(): FlowSwitchRecord[] {
        return this.records.all();
    }

    async set(projectId: string, viewId: string, next: FlowSwitch): Promise<FlowSwitch> {
        await this.records.write({ ...next, id: flowKey(projectId, viewId), projectId, viewId });
        this.emit({ event: 'flow.switched', payload: { projectId, viewId, switch: next } });
        return next;
    }
}

/* The record without the three fields that only say where it belongs. */
const switchOf = (record: FlowSwitchRecord): FlowSwitch => {
    const { id: _id, projectId: _projectId, viewId: _viewId, ...rest } = record;
    return rest;
};
