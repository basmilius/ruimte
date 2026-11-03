import { EXTENSION_ACTIONS } from './extension-permissions.ts';

/*
 * What the client host of an extension decides without drawing anything: the places of its slots and the permission
 * of each call. The host refuses with it, and `ruimte extension test` holds an author's code to the same answers. Pure,
 * with no import that needs zod.
 */

/* Every place an extension may put an action, a menu or a widget: the `SlotName` of `@ruimte/extension/client`. */
export const EXTENSION_SLOT_NAMES = [
    'selectionBar',
    'nodeHeader',
    'nodeMenu',
    'canvasMenu',
    'lineMenu',
    'viewToolbar',
    'viewMenu',
    'panelHeader',
    'commandPalette',
    'projectMenu',
    'sidebarFooter',
    'editorStatusBar',
    'sidebarRow',
    'tabMenu',
    'emptyCanvas',
    'startScreen',
    'projectBanner',
    'threadHeader',
    'emptyThread',
    'toolActions',
    'fileRowBadge',
    'fileBreadcrumb',
    'terminalMenu',
    'browserMenu',
    'textMenu',
    'noteToolbar',
    'routineMenu',
    'composer',
    'messageActions',
    'fileMenu',
    'editorToolbar',
    'editorMenu',
    'diffToolbar',
    'terminalToolbar',
    'browserToolbar'
] as const;
export type ExtensionSlotName = (typeof EXTENSION_SLOT_NAMES)[number];

export function isExtensionSlotName(name: string): name is ExtensionSlotName {
    return (EXTENSION_SLOT_NAMES as readonly string[]).includes(name);
}

// The area of the client API that calls the actions of the machine of each prefix: `launches.start` is `launch.start`.
const MACHINE_AREAS: Readonly<Record<string, string>> = {
    launch: 'launches',
    routine: 'routines',
    artifact: 'artifacts',
    browser: 'browser',
    device: 'devices'
};

/* The client API's call of a machine action, by its path. */
export function extensionActionCall(action: string): string {
    const dot = action.indexOf('.');

    return `${MACHINE_AREAS[action.slice(0, dot)] ?? action.slice(0, dot)}${action.slice(dot)}`;
}

/*
 * The permission each call of `@ruimte/extension/client` needs, by its path, checked before anything else. A hook has no
 * Result, so one without its permission fails the surface that draws it. A call that is not here needs none.
 */
export const EXTENSION_CLIENT_PERMISSIONS: Readonly<Record<string, string>> = {
    'files.readText': 'files.read',
    'files.write': 'files.write',
    'files.list': 'files.read',
    'files.watch': 'files.read',
    'git.status': 'git.read',
    'git.diff': 'git.read',
    'git.log': 'git.read',
    'terminals.read': 'terminals.read',
    'terminals.open': 'canvas.write',
    'database.connections': 'database.read',
    'database.query': 'database.read',
    'chats.list': 'chats.read',
    'chats.read': 'chats.read',
    'chats.send': 'chats.send',
    'views.createCanvas': 'views.write',
    'views.rename': 'views.write',
    'context.read': 'context.read',
    'agents.run': 'agents.run',
    'agents.stream': 'agents.run',
    'agents.start': 'agents.start',
    'canvas.createNote': 'canvas.write',
    'canvas.createFile': 'canvas.write',
    'canvas.createBrowser': 'canvas.write',
    'canvas.createNode': 'canvas.write',
    'canvas.update': 'canvas.write',
    'canvas.writeNote': 'canvas.write',
    'canvas.arrange': 'canvas.write',
    'canvas.remove': 'canvas.write',
    'canvas.group': 'canvas.write',
    'canvas.link': 'canvas.write',
    'canvas.unlink': 'canvas.write',
    useAgents: 'agents.status',
    useUsageLimits: 'usage.read',
    // It opens the chat when it is not running, so it starts an agent as `agents.start` does.
    Chat: 'agents.start',
    ...Object.fromEntries(Object.entries(EXTENSION_ACTIONS).map(([action, permission]) => [extensionActionCall(action), permission]))
};

/* The permission a call of the client API needs, or null for one that needs none. */
export function extensionCallPermission(call: string): string | null {
    return Object.hasOwn(EXTENSION_CLIENT_PERMISSIONS, call) ? (EXTENSION_CLIENT_PERMISSIONS[call] ?? null) : null;
}

/* What an extension reads when its manifest does not ask for a permission, on the client and on the machine alike. */
export function missingPermissionMessage(extension: string, permission: string): string {
    return `${extension} did not ask for the permission ${permission} in its manifest`;
}

/* Why a surface is no lazy import, such as `() => import('./Panel')`, or null when it is one or a frame. */
export function lazyComponentProblem(surface: { component?: unknown; frame?: unknown }, what: string): string | null {
    const { component } = surface;

    if (surface.frame !== undefined || (typeof component === 'function' && component.length === 0 && !/^(class|function [A-Z])/.test(String(component)))) {
        return null;
    }

    return `${what}: component must be a lazy import, such as () => import('./Panel')`;
}

/* Why a shortcut breaks the rule of every shortcut, a key on its own, or null when it has mod or alt. */
export function shortcutProblem(shortcut: string): string | null {
    const parts = shortcut.toLowerCase().split('+');

    return parts.some((part) => part === 'mod' || part === 'alt') ? null : `${shortcut} has no modifier: a shortcut needs mod or alt`;
}

const WINDOWS_ABSOLUTE = /^([A-Za-z]:[\\/]|[\\/]{2})/;

interface SplitPath {
    // `/`, `C:\`, `\\` of a UNC path or `\` of a drive's own root, so a folder at the root keeps it: `/` and `C:\` stay whole.
    root: string;
    parts: string[];
}

function splitPath(path: string, separator: string): SplitPath {
    const drive = /^([A-Za-z]:)[\\/]/.exec(path)?.[1];
    const root = drive !== undefined ? `${drive}${separator}` : /^[\\/]{2}/.test(path) ? `${separator}${separator}` : /^[\\/]/.test(path) ? separator : '';

    return {
        root,
        parts: path
            .slice(drive === undefined ? 0 : 2)
            .split(/[\\/]/)
            .filter((part) => part !== '' && part !== '.')
    };
}

function joinedPath({ root, parts }: SplitPath, separator: string): string {
    return `${root}${parts.join(separator)}`;
}

/*
 * A path an extension names, inside the project folder: relative to it, or absolute, also with a drive letter or as a
 * UNC path. Written with the separator of the folder. Null for one that leaves it, through either slash, since a
 * Windows machine reads `sub\..\..\x` as two steps up, and compared without case there, as Windows names files.
 */
export function extensionProjectPath(folder: string, path: string): string | null {
    const windows = WINDOWS_ABSOLUTE.test(folder);
    const separator = windows ? '\\' : '/';
    const absolute = path.startsWith('/') || path.startsWith('\\') || WINDOWS_ABSOLUTE.test(path);
    const inFolder = splitPath(folder, separator);
    const named = absolute ? splitPath(path, separator) : { root: inFolder.root, parts: [...inFolder.parts, ...splitPath(path, separator).parts] };
    const root = joinedPath(inFolder, separator);
    const joined = joinedPath(named, separator);
    const same = (text: string): string => (windows ? text.toLowerCase() : text);
    const within = same(root.endsWith(separator) ? root : `${root}${separator}`);

    if (named.parts.includes('..') || (same(joined) !== same(root) && !same(joined).startsWith(within))) {
        return null;
    }

    return joined;
}
