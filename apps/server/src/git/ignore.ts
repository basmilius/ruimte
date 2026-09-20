import { dirname } from 'node:path';
import { runGit } from './run.ts';

/*
 * Whether git has this file in its index. A project file someone committed was shared on purpose,
 * which is what the split reads it as; outside a repository the answer is no, and so is every
 * failure, because the safe reading of "I cannot tell" is that nothing travels.
 */
export const isTrackedPath = async (path: string): Promise<boolean> => {
    const { code, stdout } = await runGit(['ls-files', '-z', '--error-unmatch', '--', path], dirname(path));
    return code === 0 && stdout !== '';
};

/*
 * Which of these paths git would ignore, in one call. `check-ignore` answers 0 when something
 * matched, 1 when nothing did and 128 outside a repository, so only 128 and above mean the
 * question could not be asked; every path is then unignored. Paths go in NUL separated and come
 * back the same way, which is the only form a name with a newline in it survives.
 */
export const ignoredPaths = async (paths: readonly string[], cwd: string): Promise<Set<string>> => {
    if (paths.length === 0) {
        return new Set();
    }
    const { code, stdout } = await runGit(['check-ignore', '-z', '--stdin'], cwd, { stdin: `${paths.join('\0')}\0` });
    if (code > 1) {
        return new Set();
    }
    return new Set(stdout.split('\0').filter((path) => path !== ''));
};
