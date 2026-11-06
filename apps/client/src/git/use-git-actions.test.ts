import { describe, expect, test } from 'bun:test';
import { ActionRefusal } from '@ruimte/actions';
import type { GitActionPayload, GitActionResult } from '@ruimte/contracts';
import { useToasts } from '@/state/toasts';
import { runManyJobs, type ManyJob } from './use-git-actions';

function job(label: string): ManyJob {
    return { cwd: `/work/${label}`, kind: 'pull', label };
}

/* Pulls every repository, except that the ones named here moved on both sides. */
function pulling(diverged: readonly string[]) {
    return async (payload: GitActionPayload): Promise<GitActionResult> => {
        if (diverged.some((label) => payload.cwd === `/work/${label}`)) {
            throw new ActionRefusal('diverged', 'main and the remote have both moved on.');
        }
        return { actionId: payload.actionId, summary: 'Pulled into main.', output: '' };
    };
}

describe('a run over several repositories', () => {
    test('a branch that moved on both sides comes back as a choice, not a failure', async () => {
        const chosen: ManyJob[] = [];
        const outcome = await runManyJobs([job('app'), job('api')], new Map(), { choose: (entry) => chosen.push(entry) }, pulling(['api']));

        expect(outcome).toEqual({ done: 1, failed: 0, diverged: [job('api')] });
        const toast = useToasts.getState().toasts.at(-1)!;
        expect(toast.title).toBe('1 repository needs a choice: api');
        expect(toast.actions?.map((action) => action.label)).toEqual(['Choose for api']);

        toast.actions?.[0]?.run();
        expect(chosen).toEqual([job('api')]);
    });

    test('a failure still reads as one, beside the choice', async () => {
        const failing = async (payload: GitActionPayload): Promise<GitActionResult> => {
            if (payload.cwd === '/work/web') {
                throw new Error('fatal: could not read from remote');
            }
            return pulling(['api'])(payload);
        };
        const outcome = await runManyJobs([job('web'), job('api')], new Map(), { choose: () => undefined }, failing);

        expect(outcome).toEqual({ done: 0, failed: 1, diverged: [job('api')] });
        const toast = useToasts.getState().toasts.at(-1)!;
        expect(toast.title).toBe('1 repository failed: web');
        expect(toast.kind).toBe('error');
        expect(toast.actions?.map((action) => action.label)).toEqual(['Choose for api']);
    });
});
