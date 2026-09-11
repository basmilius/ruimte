import { useToasts } from '@/state/toasts';
import { transport } from '@/transport';

/*
 * Move files in and out of the index. The git panel wraps its own busy flag and status read around
 * this; everywhere else the daemon's watcher is what brings the new status along.
 */
export const stageFiles = async (cwd: string, paths: readonly string[], staged: boolean): Promise<boolean> => {
    if (paths.length === 0) {
        return false;
    }
    try {
        await transport.request('git.stage', { cwd, paths: [...paths], staged });
        return true;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'That did not work.';
        useToasts.getState().show({ title: staged ? 'Staging failed' : 'Unstaging failed', description: message, kind: 'error', output: message });
        return false;
    }
};
