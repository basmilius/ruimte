/*
 * What starts a machine of Ruimte in the dev container of a project folder: reading its devcontainer.json, the names of
 * what a start makes, and the programs of the start. It describes and runs nothing, and uses no API of Node, Bun or a
 * page: whoever reads the files and runs the programs hands them in. The Dev Containers extension describes a start for
 * a machine to run, and the desktop app without a machine of its own runs the same one itself.
 */
export {
    DEVCONTAINER_FILES,
    fromProject,
    readDevcontainer,
    type Devcontainer,
    type DevcontainerBuild,
    type DevcontainerPlace,
    type DevcontainerRead
} from './devcontainer.ts';
export { parseJsonc } from './jsonc.ts';
export { namesOf, sha256, type ContainerNames } from './names.ts';
export { checkoutOrigin, linuxArchOf, type LinuxArch, type MachineOrigin } from './origin.ts';
export {
    describeDevcontainer,
    findDevcontainer,
    fingerprintOf,
    type DevcontainerParts,
    type FoundDevcontainer,
    type ReadText,
    type TextRead
} from './project.ts';
export type { Spawn, Start, Step } from './spawn.ts';
export { describeStart, LOGIN_FOLDER, MACHINE_FOLDER, MADE_FROM_LABEL, STATE_FOLDER, type StartParts } from './steps.ts';
