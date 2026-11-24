import { defineProblemSource, defineServer, files, log, onEvent, problems, schedule, type FileProblems, type ProjectRef } from '@ruimte/extension/server';
import { problemsIn } from './lint';
import { CHECKED, SKIPPED } from './service';

export const SOURCE = 'rules';

// Well under what Ruimte holds for one source, so a large project is checked in part and never refused whole.
const MAX_FILES = 300;
const MAX_DEPTH = 6;

interface Following {
    /* The files Lintel said something about, which a later check takes back when they are clean or gone. */
    reported: Set<string>;
    found: number;
    stopWatching(): void;
    /* The check that runs, and whether something changed while it did. */
    checking: Promise<void> | null;
    again: boolean;
}

// The projects a person has open, which are the ones Lintel checks.
const following = new Map<string, Following>();

defineProblemSource({ id: SOURCE, title: 'Lintel' });

async function sourceFiles(project: ProjectRef, folder = '.', depth = 0, found: string[] = []): Promise<string[]> {
    const listed = await files.list(project, folder);

    for (const entry of listed.ok ? listed.value : []) {
        const path = folder === '.' ? entry.name : `${folder}/${entry.name}`;

        if (found.length >= MAX_FILES) {
            break;
        }

        if (entry.kind === 'directory' && depth < MAX_DEPTH && !entry.name.startsWith('.') && !SKIPPED.includes(entry.name)) {
            await sourceFiles(project, path, depth + 1, found);
        } else if (entry.kind === 'file' && CHECKED.some((end) => entry.name.endsWith(end))) {
            found.push(path);
        }
    }

    return found;
}

async function checkOnce(project: ProjectRef, followed: Following): Promise<void> {
    const found: FileProblems[] = [];

    for (const path of await sourceFiles(project)) {
        const read = await files.readText(project, path);
        const inFile = read.ok ? problemsIn(read.value) : [];

        if (inFile.length > 0) {
            found.push({ path, problems: inFile });
        }
    }

    const withProblems = new Set(found.map((file) => file.path));
    // A report with no problems takes back what was said of a file that is clean now, or gone.
    const cleared = [...followed.reported].filter((path) => !withProblems.has(path)).map((path) => ({ path, problems: [] }));
    const reported = await problems.report(project, SOURCE, [...found, ...cleared]);

    if (!reported.ok) {
        log.error(`Lintel could not report what it found: ${reported.error.message}`);

        return;
    }

    followed.reported = withProblems;
    followed.found = found.reduce((sum, file) => sum + file.problems.length, 0);
}

/* One check of a project at a time: a change that comes while one runs starts one more, however many changes there were. */
function check(projectId: string): Promise<void> {
    const followed = following.get(projectId);

    if (followed === undefined) {
        return Promise.resolve();
    }

    if (followed.checking !== null) {
        followed.again = true;

        return followed.checking;
    }

    const run = async (): Promise<void> => {
        do {
            followed.again = false;
            await checkOnce({ id: projectId }, followed);
        } while (followed.again && following.get(projectId) === followed);

        followed.checking = null;
    };

    followed.checking = run().catch((e: unknown) => {
        followed.checking = null;
        log.error('Lintel could not check the project:', e);
    });

    return followed.checking;
}

onEvent('project.opened', ({ project }) => {
    if (following.has(project.id)) {
        return;
    }

    const followed: Following = { reported: new Set(), found: 0, stopWatching: () => undefined, checking: null, again: false };

    following.set(project.id, followed);
    void files
        .watch(project, '.', () => void check(project.id))
        .then((watching) => {
            if (!watching.ok) {
                log.error(`Lintel does not follow the files of ${project.name}: ${watching.error.message}`);
            } else if (following.get(project.id) === followed) {
                followed.stopWatching = watching.value;
            } else {
                watching.value();
            }
        });
    void check(project.id);
});

onEvent('project.closed', ({ project }) => {
    following.get(project.id)?.stopWatching();
    following.delete(project.id);
    void problems.clear(project, SOURCE);
});

// A change the watch missed, such as one on a disk that reports none, is found within five minutes.
schedule({
    id: 'check-again',
    every: '5m',
    run: async () => {
        for (const projectId of following.keys()) {
            await check(projectId);
        }
    }
});

const api = defineServer({
    /* How much Lintel found in a project a person has open, once the check that runs is done; null for any other project. */
    async found(projectId: string) {
        const followed = following.get(projectId);

        if (followed === undefined) {
            return null;
        }

        await followed.checking;

        return { files: followed.reported.size, problems: followed.found };
    }
});

export type LintelServer = typeof api;
export default api;
