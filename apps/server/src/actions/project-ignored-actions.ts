import type { ActionHandlers } from '@ruimte/actions';
import { VerbRefusal } from '../canvas/verb.ts';
import { listIgnoredFiles } from '../git/ignored.ts';
import { GitError } from '../git/run.ts';
import type { ServerActionContext } from './context.ts';

export const projectIgnoredActions: ActionHandlers<ServerActionContext> = {
    'project.ignoredFiles': async (_input, { context }) => {
        try {
            const { root, files, truncated } = await listIgnoredFiles(context.place.folder);
            return { output: { root, files, truncated } };
        } catch (e) {
            if (e instanceof GitError && e.code === 'not-a-repo') {
                throw new VerbRefusal('not-a-repository', `${context.place.folder} is not in a git repository`);
            }
            throw e;
        }
    }
};
