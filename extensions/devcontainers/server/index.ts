import { checkoutOrigin, describeDevcontainer, findDevcontainer, linuxArchOf, namesOf, type ReadText } from '@ruimte/devcontainer';
import { defineMachineSource, files, log, type ProjectInfo } from '@ruimte/extension/server';

export const SOURCE = 'devcontainer';
export const CANDIDATE = 'devcontainer';

/* The variable a checkout of Ruimte names itself in for what it starts (`apps/server/scripts/dev.ts`). */
export const CHECKOUT_VARIABLE = 'RUIMTE_DEV_CHECKOUT';

// The types an extension is checked with know no runtime, and `server/` runs in one that has this.
const runtime = (globalThis as { process?: { arch: string; env: Record<string, string | undefined> } }).process;

function readerOf(project: ProjectInfo): ReadText {
    return (path) => files.readText(project, path);
}

/*
 * The dev container of a project as a place Ruimte can start a machine in. Dev Containers reads the file and describes
 * the programs, and Ruimte runs them after a person approved them. It asks the engine nothing itself, so it cannot tell
 * whether the container runs: every program can run again, and a start of one that runs changes nothing.
 */
defineMachineSource({
    id: SOURCE,
    title: 'Dev Containers',
    async list(project) {
        const found = await findDevcontainer(project.folder, readerOf(project));

        if (found === null) {
            return [];
        }

        const title = (found.read.ok ? found.read.value.name : null) ?? project.name;
        const place = found.read.ok ? (await namesOf(project.folder)).container : `Cannot start ${found.file}: ${found.read.reason}`;

        return [{ id: CANDIDATE, title, place: place.slice(0, 200), running: false }];
    },
    async start(candidate, { project, report }) {
        const found = await findDevcontainer(project.folder, readerOf(project));

        if (found === null) {
            throw new Error('This project has no devcontainer.json anymore');
        }

        report(`Reading ${found.file}`);

        if (!found.read.ok) {
            throw new Error(`Dev Containers cannot start ${found.file}: ${found.read.reason}`);
        }

        const devcontainer = found.read.value;

        if (devcontainer.ignored.length > 0) {
            const ignored = `Ignoring what Dev Containers does not read in ${found.file}: ${devcontainer.ignored.join(', ')}`;

            report(ignored);
            log.info(ignored);
        }

        const origin = checkoutOrigin(linuxArchOf(runtime?.arch ?? ''), runtime?.env[CHECKOUT_VARIABLE]);

        if (origin === null) {
            throw new Error('This Ruimte has no build for Linux to put in a container yet. Dev Containers works from a checkout of Ruimte for now.');
        }

        return describeDevcontainer({ folder: project.folder, found, devcontainer, label: candidate.title, origin, readText: readerOf(project) });
    }
});
