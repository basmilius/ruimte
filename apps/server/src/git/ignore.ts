import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { climbsOut } from '@adecore/utils/path';
import { realOrNull } from '../fs/real-path.ts';
import { nativePath } from './native-path.ts';
import { runGit } from './run.ts';

function relativeIgnorePath(path: string, cwd: string): string {
    if (!isAbsolute(path)) {
        return path;
    }
    const local = relative(cwd, path);
    if (local === '' || climbsOut(local)) {
        return path;
    }
    const trailing = path.endsWith(sep) || (sep !== '/' && path.endsWith('/'));
    // A leading colon in a filename must not become Git pathspec magic.
    return `.${sep}${local}${trailing ? sep : ''}`;
}

/*
 * Whether git has this file in its index. A project file someone committed was shared on purpose,
 * which is what the split reads it as; outside a repository the answer is no, and so is every
 * failure, because the safe reading of "I cannot tell" is that nothing travels.
 */
export async function isTrackedPath(path: string): Promise<boolean> {
    const { code, stdout } = await runGit(['ls-files', '-z', '--error-unmatch', '--', path], dirname(path));
    return code === 0 && stdout !== '';
}

/*
 * Which of these paths git would ignore, in one call. `check-ignore` answers 0 when something
 * matched, 1 when nothing did and 128 outside a repository, so only 128 and above mean the
 * question could not be asked; every path is then unignored. Paths go in NUL separated and come
 * back the same way, which is the only form a name with a newline in it survives.
 */
async function checkIgnore(paths: readonly string[], cwd: string): Promise<Set<string>> {
    let queries: Map<string, string[]> | undefined;
    if (paths.some((path) => isAbsolute(path))) {
        const canonical = await realOrNull(cwd);
        // With an aliased cwd, Git canonicalizes every absolute path again; relative input avoids it.
        if (canonical !== null && canonical !== resolve(cwd)) {
            queries = new Map();
            for (const path of paths) {
                const query = nativePath(relativeIgnorePath(path, cwd));
                queries.set(query, [...(queries.get(query) ?? []), nativePath(path)]);
            }
        }
    }
    const input = queries ? [...queries.keys()].map((path) => (sep === '\\' ? path.replaceAll('\\', '/') : path)) : paths;
    const { code, stdout } = await runGit(['check-ignore', '-z', '--stdin'], cwd, { stdin: `${input.join('\0')}\0` });
    if (code > 1) {
        return new Set();
    }
    const matches = stdout
        .split('\0')
        .filter((path) => path !== '')
        .map((path) => nativePath(path));
    if (!queries) {
        return new Set(matches);
    }
    return new Set(matches.flatMap((path) => queries.get(path) ?? []));
}

interface Batch {
    paths: Set<string>;
    answer: Promise<Set<string>>;
}

// Per checkout: the batch that still takes paths, and the git run it waits for.
const waiting = new Map<string, Batch>();
const running = new Map<string, Promise<unknown>>();

/*
 * Which of these paths git would ignore. An opening files panel lists every folder it had open at
 * once, and a git process per folder costs three times one for all of them, so whatever comes in
 * while git runs for a checkout goes in the one run after it.
 */
export function ignoredPaths(paths: readonly string[], cwd: string): Promise<Set<string>> {
    if (paths.length === 0) {
        return Promise.resolve(new Set());
    }
    let batch = waiting.get(cwd);
    if (batch === undefined) {
        const asked = new Set<string>();
        const before = (running.get(cwd) ?? Promise.resolve()).catch(() => undefined);
        const answer = before.then(() => {
            waiting.delete(cwd);
            const run = checkIgnore([...asked], cwd);
            running.set(cwd, run);
            void run
                .catch(() => undefined)
                .finally(() => {
                    if (running.get(cwd) === run) {
                        running.delete(cwd);
                    }
                });
            return run;
        });
        batch = { paths: asked, answer };
        waiting.set(cwd, batch);
    }
    for (const path of paths) {
        batch.paths.add(path);
    }
    return batch.answer.then((ignored) => new Set(paths.filter((path) => ignored.has(path))));
}
