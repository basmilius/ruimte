import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { LaunchConfig, LaunchConfigEnv, LaunchConfigKind, LaunchSuggestion } from '@ruimte/contracts';
import { isInside } from '../canvas/project-paths.ts';

/*
 * Launches a project already describes in its own files: run configurations from `.run.xml` files,
 * the scripts of a `package.json` and those of a `composer.json`. Nothing here runs or writes
 * anything; a person reviews every suggestion before it becomes a launch.
 */

// Deep enough for `backend/dev/run` under a project folder, shallow enough to stay out of a large tree.
const RUN_FILE_DEPTH = 4;
const MAX_DIRECTORIES = 2_000;
const MAX_SUGGESTIONS = 200;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'cache']);
// Hidden folders are tooling and a leading tilde is a backup copy; these hold run configurations.
const RUN_FILE_FOLDERS = new Set(['.run', '.idea', 'runConfigurations']);

function walksInto(name: string): boolean {
    return RUN_FILE_FOLDERS.has(name) || (!SKIPPED_DIRECTORIES.has(name) && !name.startsWith('.') && !name.startsWith('~'));
}

// Scripts a package manager runs by itself around an install or a publish, which nobody launches.
const LIFECYCLE_SCRIPTS = new Set([
    'preinstall',
    'install',
    'postinstall',
    'prepare',
    'prepublish',
    'prepublishOnly',
    'prepack',
    'postpack',
    'publish',
    'postpublish',
    'preversion',
    'version',
    'postversion',
    'dependencies'
]);
const SERVICE_NAME = /^(dev|start|serve|server|preview|watch)([:_-]|$)/i;

interface XmlElement {
    name: string;
    attributes: Record<string, string>;
    children: XmlElement[];
}

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
        if (entity.startsWith('#')) {
            const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
            return Number.isNaN(code) ? whole : String.fromCodePoint(code);
        }
        return ENTITIES[entity.toLowerCase()] ?? whole;
    });
}

/* Elements and attributes only: a run configuration keeps everything it says in attributes. */
export function parseXml(text: string): XmlElement {
    const root: XmlElement = { name: '#document', attributes: {}, children: [] };
    const stack = [root];
    const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
    for (const match of body.matchAll(TAG)) {
        const [, closing, name = '', attributeText = '', selfClosing] = match;
        const parent = stack[stack.length - 1]!;
        if (closing === '/') {
            if (stack.length > 1 && parent.name === name) {
                stack.pop();
            }
            continue;
        }
        const attributes: Record<string, string> = {};
        for (const attribute of attributeText.matchAll(ATTRIBUTE)) {
            attributes[attribute[1]!] = decodeEntities(attribute[2] ?? attribute[3] ?? '');
        }
        const element: XmlElement = { name, attributes, children: [] };
        parent.children.push(element);
        if (selfClosing !== '/') {
            stack.push(element);
        }
    }
    return root;
}

function childrenOf(element: XmlElement, name: string): XmlElement[] {
    return element.children.filter((child) => child.name === name);
}

function childOf(element: XmlElement, name: string): XmlElement | undefined {
    return element.children.find((child) => child.name === name);
}

function descendantsOf(element: XmlElement, name: string): XmlElement[] {
    return element.children.flatMap((child) => [...(child.name === name ? [child] : []), ...descendantsOf(child, name)]);
}

/* `<option name="…" value="…"/>`, the way most run configuration types store their fields. */
function optionOf(element: XmlElement, name: string): string | undefined {
    return childrenOf(element, 'option').find((option) => option.attributes.name === name)?.attributes.value;
}

function shellQuote(value: string): string {
    return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

export function slugOf(name: string): string {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'launch'
    );
}

function filled(value: string | undefined): value is string {
    return value !== undefined && value !== '';
}

function titleOf(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function kindOfScript(name: string): LaunchConfigKind {
    return SERVICE_NAME.test(name) ? 'service' : 'task';
}

/* Where the paths of one launch are read from and what they point at. */
class PathScope {
    /* A path in the launch points outside the project, so it cannot travel with it. */
    outside = false;

    private readonly folder: string;
    private readonly projectDir: string;
    private readonly cwd: string;

    constructor(folder: string, projectDir: string, cwd: string) {
        this.folder = folder;
        this.projectDir = projectDir;
        this.cwd = cwd;
    }

    /* The macros a run configuration writes paths with, as absolute paths. */
    expand(value: string): string {
        return value.replaceAll('$PROJECT_DIR$', this.projectDir).replaceAll('$USER_HOME$', homedir());
    }

    /* A path as the command writes it: relative to where it runs, or absolute once it leaves the project. */
    path(value: string): string {
        const absolute = resolve(this.cwd, this.expand(value));
        if (!isInside(this.folder, absolute)) {
            this.outside = true;
            return absolute;
        }
        return relative(this.cwd, absolute) || '.';
    }

    /* Every macro path inside a line of arguments, rewritten the same way. */
    line(value: string): string {
        return value
            .replace(/\$(PROJECT_DIR|USER_HOME)\$([^\s"'=]*)/g, (whole) => this.path(whole))
            .trim()
            .replace(/\s+/g, ' ');
    }
}

interface RunFileContext {
    folder: string;
    file: string;
    projectDir: string;
}

type Built = { launch: LaunchConfig; detail: string; outside: boolean; unsupported?: string };

function envOf(configuration: XmlElement, scope: PathScope): LaunchConfigEnv | undefined {
    const envs = childOf(configuration, 'envs');
    if (envs === undefined) {
        return undefined;
    }
    const entries = childrenOf(envs, 'env').flatMap((env) =>
        env.attributes.name === undefined ? [] : [[env.attributes.name, scope.expand(env.attributes.value ?? '')] as const]
    );
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function phpServer(configuration: XmlElement, context: RunFileContext): Built {
    const attributes = configuration.attributes;
    const scope = new PathScope(context.folder, context.projectDir, context.projectDir);
    const host = filled(attributes.host) ? attributes.host : 'localhost';
    const port = filled(attributes.port) ? attributes.port : '80';
    const parameters = scope.line(childOf(configuration, 'CommandLine')?.attributes.parameters ?? '');
    // PHP reads its -d flags only before -S; after it they are arguments to the router.
    const parts = ['php', ...(parameters === '' ? [] : [parameters]), '-S', `${host}:${port}`];
    if (filled(attributes.document_root)) {
        parts.push('-t', shellQuote(scope.path(attributes.document_root)));
    }
    if (attributes.use_router_script === 'true' && filled(attributes.router_script)) {
        parts.push(shellQuote(scope.path(attributes.router_script)));
    }
    const address = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
    return {
        launch: {
            id: '',
            name: attributes.name ?? 'PHP server',
            kind: 'service',
            command: parts.join(' '),
            url: `http://${address}:${port}`,
            env: envOf(configuration, scope)
        },
        detail: attributes.factoryName ?? 'PHP Built-in Web Server',
        outside: scope.outside
    };
}

function pestTests(configuration: XmlElement, context: RunFileContext): Built {
    const runner = childOf(configuration, 'PestRunner')?.attributes ?? {};
    const scope = new PathScope(context.folder, context.projectDir, context.projectDir);
    const parts = ['vendor/bin/pest'];
    if (runner.parallel_testing_enabled === 'true') {
        parts.push('--parallel');
    }
    const target = filled(runner.file) ? runner.file : runner.directory;
    if (filled(target)) {
        parts.push(shellQuote(scope.path(target)));
    }
    if (filled(runner.method)) {
        parts.push('--filter', shellQuote(runner.method));
    }
    return {
        launch: { id: '', name: configuration.attributes.name ?? 'Tests', kind: 'task', command: parts.join(' '), env: envOf(configuration, scope) },
        detail: runner.parallel_testing_enabled === 'true' ? 'Pest, parallel' : 'Pest',
        outside: scope.outside
    };
}

function npmScript(configuration: XmlElement, context: RunFileContext): Built {
    const scope = new PathScope(context.folder, context.projectDir, context.projectDir);
    const packageJson = childOf(configuration, 'package-json')?.attributes.value;
    const cwd = packageJson === undefined ? context.projectDir : dirname(resolve(context.projectDir, scope.expand(packageJson)));
    const inCwd = new PathScope(context.folder, context.projectDir, cwd);
    const command = childOf(configuration, 'command')?.attributes.value ?? 'run';
    const scripts = descendantsOf(configuration, 'script').flatMap((script) => script.attributes.value ?? []);
    const argumentsLine = inCwd.line(childOf(configuration, 'arguments')?.attributes.value ?? '');
    const parts = ['npm', command, ...scripts.map(shellQuote), ...(argumentsLine === '' ? [] : ['--', argumentsLine])];
    return {
        launch: {
            id: '',
            name: configuration.attributes.name ?? scripts.join(' '),
            kind: kindOfScript(scripts[0] ?? ''),
            cwd,
            command: parts.join(' '),
            env: envOf(configuration, inCwd)
        },
        detail: configuration.attributes.factoryName ?? 'npm',
        outside: !isInside(context.folder, cwd) || inCwd.outside
    };
}

function shellScript(configuration: XmlElement, context: RunFileContext): Built {
    const scope = new PathScope(context.folder, context.projectDir, context.projectDir);
    const workingDirectory = optionOf(configuration, 'SCRIPT_WORKING_DIRECTORY');
    const scriptPath = optionOf(configuration, 'SCRIPT_PATH') ?? '';
    const cwd =
        optionOf(configuration, 'INDEPENDENT_SCRIPT_WORKING_DIRECTORY') === 'true' && filled(workingDirectory)
            ? resolve(context.projectDir, scope.expand(workingDirectory))
            : scriptPath === ''
              ? context.projectDir
              : dirname(resolve(context.projectDir, scope.expand(scriptPath)));
    const inCwd = new PathScope(context.folder, context.projectDir, cwd);
    let command: string;
    if (optionOf(configuration, 'EXECUTE_SCRIPT_FILE') === 'false') {
        command = (optionOf(configuration, 'SCRIPT_TEXT') ?? '').trim();
    } else {
        const interpreter = optionOf(configuration, 'INTERPRETER_PATH') ?? '';
        const interpreterOptions = inCwd.line(optionOf(configuration, 'INTERPRETER_OPTIONS') ?? '');
        const scriptOptions = inCwd.line(optionOf(configuration, 'SCRIPT_OPTIONS') ?? '');
        command = [interpreter, interpreterOptions, scriptPath === '' ? '' : shellQuote(inCwd.path(scriptPath)), scriptOptions]
            .filter((part) => part !== '')
            .join(' ');
    }
    return {
        launch: { id: '', name: configuration.attributes.name ?? 'Script', kind: 'task', cwd, command, env: envOf(configuration, inCwd) },
        detail: configuration.attributes.factoryName ?? 'Shell Script',
        outside: !isInside(context.folder, cwd) || inCwd.outside
    };
}

const RUN_TYPES: Record<string, (configuration: XmlElement, context: RunFileContext) => Built> = {
    PhpBuiltInWebServerConfigurationType: phpServer,
    PestRunConfigurationType: pestTests,
    'js.build_tools.npm': npmScript,
    ShConfigurationType: shellScript
};

/* Every configuration in one file; a type the import cannot read comes back with the reason. */
export function readRunFile(text: string, context: RunFileContext): Built[] {
    return descendantsOf(parseXml(text), 'configuration')
        .filter((configuration) => configuration.attributes.default !== 'true' && configuration.attributes.type !== undefined)
        .map((configuration) => {
            const type = configuration.attributes.type!;
            const read = RUN_TYPES[type];
            if (read !== undefined) {
                return read(configuration, context);
            }
            const described = configuration.attributes.factoryName ?? type;
            return {
                launch: { id: '', name: configuration.attributes.name ?? described, kind: 'task' },
                detail: described,
                outside: false,
                unsupported: described
            };
        });
}

async function exists(path: string): Promise<boolean> {
    return stat(path)
        .then(() => true)
        .catch(() => false);
}

/* The package manager of a folder by its lockfile, looked for up to the project folder for a workspace. */
async function packageRunner(folder: string, cwd: string): Promise<string> {
    for (let at = cwd; ; at = dirname(at)) {
        if ((await exists(join(at, 'bun.lock'))) || (await exists(join(at, 'bun.lockb')))) {
            return 'bun run';
        }
        if (await exists(join(at, 'pnpm-lock.yaml'))) {
            return 'pnpm run';
        }
        if (await exists(join(at, 'yarn.lock'))) {
            return 'yarn';
        }
        if (at === folder || !isInside(folder, at) || dirname(at) === at) {
            return 'npm run';
        }
    }
}

/* The address a dev server script answers on, when the tool says it without reading its config. */
export function scriptAddress(script: string): string | undefined {
    const port = /--port[= ](\d+)/.exec(script)?.[1];
    if (/^vite preview\b/.test(script)) {
        return `http://localhost:${port ?? '4173'}`;
    }
    if (/^vite( |$)(?!build)/.test(script)) {
        return `http://localhost:${port ?? '5173'}`;
    }
    if (/^next (dev|start)\b/.test(script)) {
        return `http://localhost:${port ?? '3000'}`;
    }
    return port === undefined ? undefined : `http://localhost:${port}`;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
    try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function scriptsOf(manifest: Record<string, unknown> | null): [string, string][] {
    const scripts = manifest?.scripts;
    if (typeof scripts !== 'object' || scripts === null) {
        return [];
    }
    return Object.entries(scripts).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value] as [string, string]] : []));
}

async function packageScripts(folder: string, directory: string): Promise<Built[]> {
    const scripts = scriptsOf(await readJson(join(directory, 'package.json')));
    if (scripts.length === 0) {
        return [];
    }
    const names = new Set(scripts.map(([name]) => name));
    const runner = await packageRunner(folder, directory);
    // `prebuild` and `postbuild` run with `build`, so they are no launch of their own.
    const hook = (name: string): boolean =>
        LIFECYCLE_SCRIPTS.has(name) || ((name.startsWith('pre') || name.startsWith('post')) && names.has(name.replace(/^(pre|post)/, '')));
    return scripts
        .filter(([name]) => !hook(name))
        .map(([name, script]) => {
            const kind = kindOfScript(name);
            const url = kind === 'service' ? scriptAddress(script) : undefined;
            return {
                launch: {
                    id: '',
                    name: titleOf(name),
                    kind,
                    cwd: directory,
                    command: `${runner} ${shellQuote(name)}`,
                    ...(url === undefined ? {} : { url })
                },
                detail: name,
                outside: false
            };
        });
}

async function composerScripts(directory: string): Promise<Built[]> {
    return (
        scriptsOf(await readJson(join(directory, 'composer.json')))
            // Composer's own events (`post-install-cmd`, `pre-autoload-dump`) run by themselves.
            .filter(([name]) => !/^(pre|post)-/.test(name))
            .map(([name]) => ({
                launch: {
                    id: '',
                    name: titleOf(name),
                    kind: kindOfScript(name),
                    cwd: directory,
                    command: `composer run ${shellQuote(name)}`
                },
                detail: name,
                outside: false
            }))
    );
}

/* The run configuration files under a directory, not descending into another root that is walked on its own. */
async function runFilesUnder(root: string, roots: ReadonlySet<string>, budget: { directories: number }): Promise<string[]> {
    const found: string[] = [];
    const walk = async (directory: string, depth: number): Promise<void> => {
        if (budget.directories <= 0) {
            return;
        }
        budget.directories--;
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(directory, entry.name);
            if (entry.isFile() && (entry.name.endsWith('.run.xml') || (basename(directory) === 'runConfigurations' && entry.name.endsWith('.xml')))) {
                found.push(path);
            } else if (entry.isDirectory() && depth > 0 && walksInto(entry.name) && !roots.has(path)) {
                await walk(path, depth - 1);
            }
        }
    };
    await walk(root, RUN_FILE_DEPTH);
    return found;
}

/* What `$PROJECT_DIR$` stands for: the folder that holds the settings the file belongs to, else its checkout. */
async function projectDirOf(file: string, root: string): Promise<string> {
    for (let at = dirname(file); isInside(root, at); at = dirname(at)) {
        if (await exists(join(at, '.idea'))) {
            return at;
        }
        if (at === root) {
            break;
        }
    }
    return root;
}

/*
 * Suggestions from the project folder and each checkout in it. Ids are unique among the suggestions;
 * the client makes them unique against the launches the project already has.
 */
export async function detectLaunches(folder: string, checkouts: readonly string[]): Promise<LaunchSuggestion[]> {
    const roots = [folder, ...checkouts.filter((path) => path !== folder && isInside(folder, path))];
    const rootSet = new Set(roots);
    const budget = { directories: MAX_DIRECTORIES };
    const found: { built: Built; source: LaunchSuggestion['source']; path: string }[] = [];
    for (const root of roots) {
        for (const file of await runFilesUnder(root, rootSet, budget)) {
            const text = await readFile(file, 'utf8').catch(() => null);
            if (text === null) {
                continue;
            }
            const context = { folder, file, projectDir: await projectDirOf(file, root) };
            for (const built of readRunFile(text, context)) {
                found.push({ built: { ...built, launch: { cwd: context.projectDir, ...built.launch } }, source: 'run-xml', path: file });
            }
        }
        for (const built of await composerScripts(root)) {
            found.push({ built, source: 'composer-json', path: join(root, 'composer.json') });
        }
        for (const built of await packageScripts(folder, root)) {
            found.push({ built, source: 'package-json', path: join(root, 'package.json') });
        }
    }
    const taken = new Set<string>();
    return found.slice(0, MAX_SUGGESTIONS).map(({ built, source, path }) => {
        const base = slugOf(built.launch.name);
        let id = base;
        for (let i = 2; taken.has(id); i++) {
            id = `${base}-${i}`;
        }
        taken.add(id);
        const cwd = built.launch.cwd === undefined ? undefined : relative(folder, built.launch.cwd);
        const launch: LaunchConfig = { ...built.launch, id };
        if (cwd === undefined || cwd === '') {
            delete launch.cwd;
        } else {
            launch.cwd = isInside(folder, built.launch.cwd!) ? cwd : built.launch.cwd;
        }
        if (launch.env === undefined) {
            delete launch.env;
        }
        return {
            launch,
            source,
            path: relative(folder, path),
            detail: built.detail,
            private: built.outside,
            ...(built.unsupported === undefined ? {} : { unsupported: built.unsupported })
        };
    });
}
