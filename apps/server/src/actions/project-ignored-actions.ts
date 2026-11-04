import { ToolRefusal } from '@adecore/agents/context';
import type { ActionHandlers } from '@ruimte/actions';
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
                throw new ToolRefusal('not-a-repository', `${context.place.folder} is not in a git repository`);
            }
            throw e;
        }
    }
};
