import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { isRecord } from '@adecore/utils/record';
import type { LaunchConfigEnv } from '@ruimte/contracts';
import { isInside } from '../tools/project-paths.ts';
import { kindOfScript, portable, shellQuote, unsupported, type Built } from './detect.ts';

/*
 * The node launch configurations of a `.vscode/launch.json`. Only what a launch can say is read: a
 * command, a folder and variables. Everything that needs the editor around it (attaching, a task
 * before the run, an env file, a variable of the open file) comes back as unsupported with its name.
 */

const NODE_TYPES = new Set(['node', 'pwa-node']);
const PLATFORM_OVERRIDES = ['osx', 'linux', 'windows'] as const;
const VARIABLE = /\$\{[^}]*\}/g;
const SCRIPT_RUNNERS = new Set(['run', 'run-script']);

class Unsupported extends Error {}

/* Resolves the variables a launch may use; any other one makes the whole configuration unsupported. */
class Variables {
    /* A variable pointed at the person's home, so the launch cannot travel with the project. */
    outside = false;

    /* Whether the last expansion put a machine path in the text. */
    expandedPath = false;

    private readonly root: string;

    constructor(root: string) {
        this.root = root;
    }

    expand(value: string): string {
        this.expandedPath = false;
        return value.replace(VARIABLE, (token) => {
            switch (token) {
                case '${workspaceFolder}':
                case '${workspaceRoot}':
                    this.expandedPath = true;
                    return this.root;
                case '${userHome}':
                    this.outside = true;
                    this.expandedPath = true;
                    return homedir();
                case '${pathSeparator}':
                case '${/}':
                    return '/';
                default:
                    throw new Unsupported(token);
            }
        });
    }
}

function strings(value: unknown, field: string): string[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new Unsupported(field);
    }
    return value as string[];
}

function envOf(value: unknown, variables: Variables): LaunchConfigEnv | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
        throw new Unsupported('env');
    }
    const entries = Object.entries(value as Record<string, string>).map(([name, entry]) => {
        const expanded = variables.expand(entry);
        // An environment value is never relativized, so a machine path in it stays this machine's.
        variables.outside ||= variables.expandedPath;
        return [name, expanded] as const;
    });
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/* The script `npm run dev` names, so its kind follows the script rather than the configuration's own name. */
function scriptOf(runtimeArgs: readonly string[]): string | undefined {
    const at = runtimeArgs.findIndex((argument) => SCRIPT_RUNNERS.has(argument));
    return at === -1 ? undefined : runtimeArgs[at + 1];
}

function build(configuration: Record<string, unknown>, name: string, root: string, folder: string): Built {
    const type = String(configuration.type);
    if (!NODE_TYPES.has(type)) {
        throw new Unsupported(type);
    }
    if (configuration.request !== 'launch') {
        throw new Unsupported(typeof configuration.request === 'string' ? configuration.request : 'request');
    }
    for (const field of ['preLaunchTask', 'postDebugTask', 'envFile', ...PLATFORM_OVERRIDES]) {
        if (configuration[field] !== undefined) {
            throw new Unsupported(field);
        }
    }
    if (typeof configuration.args === 'string') {
        throw new Unsupported('args');
    }
    const variables = new Variables(root);
    const runtimeArgs = strings(configuration.runtimeArgs, 'runtimeArgs');
    const args = strings(configuration.args, 'args');
    if (configuration.program !== undefined && typeof configuration.program !== 'string') {
        throw new Unsupported('program');
    }
    if (configuration.program === undefined && runtimeArgs.length === 0) {
        throw new Unsupported('program');
    }
    if (configuration.runtimeExecutable !== undefined && typeof configuration.runtimeExecutable !== 'string') {
        throw new Unsupported('runtimeExecutable');
    }
    if (configuration.cwd !== undefined && typeof configuration.cwd !== 'string') {
        throw new Unsupported('cwd');
    }
    const cwd = resolve(root, variables.expand(configuration.cwd ?? '${workspaceFolder}'));
    // An absolute path inside the project is written relative to where the command runs, the way a run file's paths are.
    const part = (value: string, executable = false): string => {
        const expanded = variables.expand(value);
        if (expanded === value) {
            return shellQuote(expanded);
        }
        // Only a path a variable made absolute is the project's to place; an argument that happens to start with a slash is not.
        if (isAbsolute(expanded) && isInside(folder, expanded)) {
            const below = portable(relative(cwd, expanded)) || '.';
            // A bare name would be looked up on the PATH instead of in the working folder.
            return shellQuote(executable && !below.includes('/') ? `./${below}` : below);
        }
        variables.outside ||= variables.expandedPath;
        return shellQuote(expanded);
    };
    const command = [
        configuration.runtimeExecutable ?? 'node',
        ...runtimeArgs,
        ...(configuration.program === undefined ? [] : [configuration.program]),
        ...args
    ]
        .map((value, index) => part(value as string, index === 0))
        .join(' ');
    const env = envOf(configuration.env, variables);
    return {
        launch: {
            id: '',
            name,
            kind: kindOfScript(scriptOf(runtimeArgs) ?? name),
            cwd,
            command,
            ...(env === undefined ? {} : { env })
        },
        detail: type,
        outside: variables.outside || !isInside(folder, cwd)
    };
}

/* A `launch.json` is JSON with comments and trailing commas. */
function parseJsonc(text: string): unknown {
    try {
        return Bun.JSONC.parse(text);
    } catch {
        return null;
    }
}

/* Every configuration and compound in one launch.json; one this import cannot read comes back with the reason. */
export function readVscodeLaunch(text: string, root: string, folder: string): Built[] {
    const document = parseJsonc(text);
    if (!isRecord(document)) {
        return [];
    }
    const configurations = Array.isArray(document.configurations) ? document.configurations : [];
    const compounds = Array.isArray(document.compounds) ? document.compounds : [];
    const read = configurations.filter(isRecord).map((configuration): Built => {
        const name = typeof configuration.name === 'string' && configuration.name.trim() !== '' ? configuration.name : 'Launch';
        try {
            return build(configuration, name, root, folder);
        } catch (error) {
            if (error instanceof Unsupported) {
                return unsupported(name, typeof configuration.type === 'string' ? configuration.type : 'launch', error.message);
            }
            throw error;
        }
    });
    const grouped = compounds
        .filter(isRecord)
        .map((compound) => unsupported(typeof compound.name === 'string' ? compound.name : 'Compound', 'compound', 'compound'));
    return [...read, ...grouped];
}
