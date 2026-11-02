import { relative } from 'node:path';
import { CodedError } from '@adecore/agents';
import { climbsOut } from './path-segment.ts';
import { realOrSelf } from './real-path.ts';

class OutsideError extends CodedError<'outside-project'> {}

/* Refuses a path whose real target is not in the real `folder`, so a symlink inside that folder cannot lead out of it. */
export async function refuseOutside(path: string, folder: string | undefined): Promise<void> {
    if (folder === undefined) {
        return;
    }

    const [real, root] = await Promise.all([realOrSelf(path), realOrSelf(folder)]);

    if (climbsOut(relative(root, real))) {
        throw new OutsideError('outside-project', `${path} is outside ${folder}`);
    }
}
