import { CodedError } from '@adecore/agents';
import { isWithin } from '@adecore/utils/path';
import { realOfNearest, realOrSelf } from '../disk/real-path.ts';

class OutsideError extends CodedError<'outside-project'> {}

/* Refuses a path whose real target is not in the real `folder`, so a symlink inside that folder cannot lead out of it. */
export async function refuseOutside(path: string, folder: string | undefined): Promise<void> {
    if (folder === undefined) {
        return;
    }

    // A file that is not there yet has no real path of its own, and a folder reached through a link (macOS's /var) would then never hold it.
    const [real, root] = await Promise.all([realOfNearest(path), realOrSelf(folder)]);

    if (!isWithin(root, real)) {
        throw new OutsideError('outside-project', `${path} is outside ${folder}`);
    }
}
