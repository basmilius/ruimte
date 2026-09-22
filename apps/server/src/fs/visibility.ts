/*
 * What a listing shows. `never` is rubbish nobody asked for and no client may draw; `shy` is there
 * once a person asks to see everything; `always` is the project itself, a leading dot or not.
 * A dot is no longer a reason on its own: `.github` and `.editorconfig` are as much of the project
 * as `package.json` is, and what is really noise is what the repository already ignores.
 */
export type FsVisibility = 'always' | 'shy' | 'never';

/* Compared in lowercase, the way the file systems these come from compare a name themselves. */
const OS_NOISE = new Set([
    '.ds_store',
    '.spotlight-v100',
    '.trashes',
    '.fseventsd',
    '.temporaryitems',
    '.documentrevisions-v100',
    '.apdisk',
    '.volumeicon.icns',
    'thumbs.db',
    'ehthumbs.db',
    'desktop.ini',
    '$recycle.bin',
    'system volume information',
    '.directory'
]);

/* A pattern the fixed names cannot catch: AppleDouble, a trash can per user, an NFS silly rename. */
const OS_NOISE_PATTERNS = [/^\._/, /^\.trash-\d+$/, /^\.nfs[0-9a-f]+$/];

/* State a tool keeps in the folder and nobody browses to: the checkout's own directory, which the
   git panel speaks for, and Ruimte's own. */
const TOOL_STATE = new Set(['.git', '.ruimte']);

/*
 * What a build writes, held by name so a folder without a repository reads the same as one with.
 * Config a team commits stays out of this list, `.vscode` and `.devcontainer` included.
 */
const BUILD_OUTPUT = new Set([
    'node_modules',
    'bower_components',
    'vendor',
    'dist',
    'build',
    'out',
    'target',
    '.build',
    '.swiftpm',
    'DerivedData',
    'xcuserdata',
    'Pods',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '.astro',
    '.turbo',
    '.parcel-cache',
    '.cache',
    '.gradle',
    '__pycache__',
    '.venv',
    'venv',
    '.tox',
    '.mypy_cache',
    '.pytest_cache',
    '.ruff_cache',
    'coverage',
    '.nyc_output',
    '.terraform',
    '.idea',
    '.vs'
]);

export const isOsNoise = (name: string): boolean => {
    const lower = name.toLowerCase();
    return OS_NOISE.has(lower) || name === 'Icon\r' || OS_NOISE_PATTERNS.some((pattern) => pattern.test(lower));
};

export const isBuildOutput = (name: string): boolean => BUILD_OUTPUT.has(name);

export interface ClassifyOptions {
    /* What `git check-ignore` said about this entry. */
    ignored?: boolean;
    /* Whether the directory it sits in is inside a checkout at all. */
    inRepository?: boolean;
}

/*
 * Outside a repository git cannot say what is generated, so a dot goes back to meaning hidden.
 * That is the one place the two readings differ, and it is the rare one: a project folder here
 * almost always has a checkout in it.
 */
export const classifyEntry = (name: string, options: ClassifyOptions = {}): FsVisibility => {
    if (TOOL_STATE.has(name) || isOsNoise(name)) {
        return 'never';
    }
    if (options.ignored === true || isBuildOutput(name)) {
        return 'shy';
    }
    if (options.inRepository !== true && name.startsWith('.')) {
        return 'shy';
    }
    return 'always';
};
