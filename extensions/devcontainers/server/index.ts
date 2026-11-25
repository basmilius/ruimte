import { defineMachineSource, files, log, type ProjectInfo } from '@ruimte/extension/server';
import { DEVCONTAINER_FILES, readDevcontainer, type Devcontainer, type DevcontainerRead } from './devcontainer';
import { machineOrigin, type LinuxArch } from './machine-origin';
import { namesOf, sha256 } from './names';
import { describeStart } from './steps';

export const SOURCE = 'devcontainer';
export const CANDIDATE = 'devcontainer';

/* The variable a checkout of Ruimte names itself in for what it starts (`apps/server/scripts/dev.ts`). */
export const CHECKOUT_VARIABLE = 'RUIMTE_DEV_CHECKOUT';

// The types an extension is checked with know no runtime, and `server/` runs in one that has this.
const runtime = (globalThis as { process?: { arch: string; env: Record<string, string | undefined> } }).process;

interface Found {
    file: string;
    text: string;
    read: DevcontainerRead;
}

async function devcontainerOf(project: ProjectInfo): Promise<Found | null> {
    for (const file of DEVCONTAINER_FILES) {
        const text = await files.readText(project, file);

        if (text.ok) {
            return { file, text: text.value, read: readDevcontainer(text.value, { file, folder: project.folder }) };
        }
    }

    return null;
}

/* The digest of the file and of every file it names, so a change to either asks a person again. */
async function fingerprintOf(project: ProjectInfo, found: Found, devcontainer: Devcontainer): Promise<string> {
    const named = devcontainer.build === null ? [] : [devcontainer.build.dockerfile];
    const texts = await Promise.all(
        named.map(async (path) => {
            const text = await files.readText(project, path);

            if (!text.ok) {
                throw new Error(`${found.file} names ${path}, which cannot be read: ${text.error.message}`);
            }

            return [path, text.value];
        })
    );

    return sha256(JSON.stringify([[found.file, found.text], ...texts]));
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
        const found = await devcontainerOf(project);

        if (found === null) {
            return [];
        }

        const title = (found.read.ok ? found.read.value.name : null) ?? project.name;
        const place = found.read.ok ? (await namesOf(project.folder)).container : `Cannot start ${found.file}: ${found.read.reason}`;

        return [{ id: CANDIDATE, title, place: place.slice(0, 200), running: false }];
    },
    async start(candidate, { project, report }) {
        const found = await devcontainerOf(project);

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

        const arch: LinuxArch = runtime?.arch === 'x64' ? 'x64' : 'arm64';
        const origin = machineOrigin(arch, runtime?.env[CHECKOUT_VARIABLE]);

        if (origin === null) {
            throw new Error('This Ruimte has no build for Linux to put in a container yet. Dev Containers works from a checkout of Ruimte for now.');
        }

        return describeStart({
            devcontainer,
            names: await namesOf(project.folder),
            origin,
            label: candidate.title,
            fingerprint: await fingerprintOf(project, found, devcontainer)
        });
    }
});
