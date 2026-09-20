import { join } from 'node:path';
import { FlowArmedTestSchema, type FlowArmedTest } from '@ruimte/contracts';
import { z } from 'zod';
import { RecordDirectory } from '../record-directory.ts';
import { flowKey } from './switch-store.ts';

const FlowArmedTestRecordSchema = FlowArmedTestSchema.extend({
    /* `<projectId>:<viewId>`, which is what makes the file name. Both parts are fields as well. */
    id: z.string().min(1),
    projectId: z.string().min(1),
    viewId: z.string().min(1)
});
export type FlowArmedTestRecord = z.infer<typeof FlowArmedTestRecordSchema>;

/*
 * The tests waiting for the next real firing, one file per flow under `$RUIMTE_HOME/flow-tests`.
 *
 * Deliberately not the switch, and deliberately not in the recipe. The switch is a person saying yes
 * to a flow running; this is a person waiting to try one, which is why a flow that is off still
 * listens while one of these sits on it. At most one per flow, and it is spent the first time it is
 * used.
 */
export class FlowArmStore {
    readonly dir: string;
    private readonly records: RecordDirectory<FlowArmedTestRecord>;

    constructor(home: string) {
        this.dir = join(home, 'flow-tests');
        this.records = new RecordDirectory({ dir: this.dir, schema: FlowArmedTestRecordSchema, idOf: (record) => record.id });
    }

    /* Reads what this machine was left waiting for. Call before anything can arm a flow. */
    load(): Promise<void> {
        return this.records.load();
    }

    of(projectId: string, viewId: string): FlowArmedTest | null {
        const record = this.records.get(flowKey(projectId, viewId));
        return record === undefined ? null : testOf(record);
    }

    /* Every flow a test is waiting on, which is the second reason the daemon listens for a trigger. */
    all(): FlowArmedTestRecord[] {
        return this.records.all();
    }

    async set(projectId: string, viewId: string, test: FlowArmedTest): Promise<void> {
        await this.records.write({ ...test, id: flowKey(projectId, viewId), projectId, viewId });
    }

    clear(projectId: string, viewId: string): Promise<void> {
        return this.records.remove(flowKey(projectId, viewId));
    }
}

/* The record without the three fields that only say where it belongs. */
const testOf = (record: FlowArmedTestRecord): FlowArmedTest => {
    const { id: _id, projectId: _projectId, viewId: _viewId, ...rest } = record;
    return rest;
};
