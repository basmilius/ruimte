import { DEVCONTAINER_FILES, readDevcontainer, type Devcontainer, type DevcontainerRead } from './devcontainer.ts';
import { namesOf, sha256 } from './names.ts';
import type { MachineOrigin } from './origin.ts';
import type { Start } from './spawn.ts';
import { describeStart } from './steps.ts';

/* A file of the project folder as whoever runs this reads it, by a path from that folder with `/`. */
export type TextRead = { ok: true; value: string } | { ok: false; error: { message: string } };
export type ReadText = (path: string) => Promise<TextRead>;

export interface FoundDevcontainer {
    /* The path of the file from the project folder. */
    file: string;
    text: string;
    read: DevcontainerRead;
}

/* The first devcontainer.json the project folder has, read; null when it has none. */
export async function findDevcontainer(folder: string, readText: ReadText): Promise<FoundDevcontainer | null> {
    for (const file of DEVCONTAINER_FILES) {
        const text = await readText(file);

        if (text.ok) {
            return { file, text: text.value, read: readDevcontainer(text.value, { file, folder }) };
        }
    }

    return null;
}

/* The digest of the file and of every file it names, so a change to either asks a person again. */
export async function fingerprintOf(found: FoundDevcontainer, devcontainer: Devcontainer, readText: ReadText): Promise<string> {
    const named = devcontainer.build === null ? [] : [devcontainer.build.dockerfile];
    const texts = await Promise.all(
        named.map(async (path) => {
            const text = await readText(path);

            if (!text.ok) {
                throw new Error(`${found.file} names ${path}, which cannot be read: ${text.error.message}`);
            }

            return [path, text.value];
        })
    );

    return sha256(JSON.stringify([[found.file, found.text], ...texts]));
}

export interface DevcontainerParts {
    /* The project folder on this computer. */
    folder: string;
    found: FoundDevcontainer;
    devcontainer: Devcontainer;
    /* What the machine in the container calls itself. */
    label: string;
    origin: MachineOrigin;
    readText: ReadText;
}

/* The programs that start the machine of a project's devcontainer.json, under the names of its folder. */
export async function describeDevcontainer({ folder, found, devcontainer, label, origin, readText }: DevcontainerParts): Promise<Start> {
    return describeStart({
        devcontainer,
        names: await namesOf(folder),
        origin,
        label,
        fingerprint: await fingerprintOf(found, devcontainer, readText)
    });
}
