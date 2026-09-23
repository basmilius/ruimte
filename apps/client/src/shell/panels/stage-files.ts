import i18next from 'i18next';
import { performAsPerson } from '@/actions/client-actions';
import { useToasts } from '@/state/toasts';

/*
 * Move files in and out of the index. The git panel wraps its own busy flag and status read around
 * this; everywhere else the daemon's watcher is what brings the new status along.
 */
export const stageFiles = async (cwd: string, paths: readonly string[], staged: boolean): Promise<boolean> => {
    if (paths.length === 0) {
        return false;
    }
    try {
        await performAsPerson(staged ? 'git.stage' : 'git.unstage', { repository: cwd, paths: [...paths] });
        return true;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : i18next.t('panels:error.generic');
        useToasts.getState().show({
            title: staged ? i18next.t('panels:git.stage.failed') : i18next.t('panels:git.stage.unstageFailed'),
            description: message,
            kind: 'error',
            output: message
        });
        return false;
    }
};
