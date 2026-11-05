import type { ExtensionActionName } from './extension-actions.ts';

/*
 * The permission each action of the machine needs. What is not here an extension cannot name. Apart from the schemas,
 * with no import that runs, so the runtimes of an extension's process and its tests carry the same table without zod.
 */
export const EXTENSION_ACTIONS: Readonly<Record<ExtensionActionName, string>> = {
    'launch.list': 'launches.read',
    'launch.read': 'launches.read',
    'launch.start': 'launches.run',
    'launch.restart': 'launches.run',
    'launch.stop': 'launches.run',
    'routine.list': 'routines.read',
    'routine.run': 'routines.run',
    'routine.pause': 'routines.run',
    'routine.resume': 'routines.run',
    'artifact.list': 'artifacts.read',
    'artifact.read': 'artifacts.read',
    'artifact.publish': 'artifacts.write',
    'browser.inspect': 'browser.control',
    'browser.navigate': 'browser.control',
    'browser.back': 'browser.control',
    'browser.forward': 'browser.control',
    'browser.reload': 'browser.control',
    'browser.screenshot': 'browser.control',
    'device.list': 'devices.control',
    'device.inspect': 'devices.control',
    'device.screenshot': 'devices.control',
    'device.tap': 'devices.control',
    'device.launch': 'devices.control'
};

/* Every permission a manifest may ask for, beside `net:<host>`. Each opens something; a name not here opens nothing. */
export const EXTENSION_PERMISSIONS: readonly string[] = [
    'canvas.write',
    'views.write',
    'artifacts.read',
    'artifacts.write',
    'browser.control',
    'context.read',
    'database.read',
    'devices.control',
    'languages.servers',
    'launches.read',
    'launches.run',
    'routines.read',
    'routines.run',
    'terminals.read',
    'files.read',
    'files.write',
    'git.read',
    'chats.read',
    'chats.send',
    'agents.run',
    'agents.start',
    'agents.status',
    'agents.tools',
    'usage.read',
    'clock'
];

const NET_PREFIX = 'net:';

// A host name, a leading `*.` for its subdomains and a port allowed: nothing a frame's policy would read as more than a source.
const FRAME_HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:\d{1,5})?$/i;

/* The host a `net:` permission lets a frame reach, or null for any other permission and for a host that is no host name. */
export function extensionFrameHost(permission: string): string | null {
    if (!permission.startsWith(NET_PREFIX)) {
        return null;
    }

    const host = permission.slice(NET_PREFIX.length);

    return host.length <= 253 && FRAME_HOST.test(host) ? host : null;
}

/* Whether a permission opens something: one of the list, or `net:` with a host name. */
export function isExtensionPermission(permission: string): boolean {
    return EXTENSION_PERMISSIONS.includes(permission) || extensionFrameHost(permission) !== null;
}

/* What a manifest asks for that this Ruimte does not know, one line per permission. */
export function extensionPermissionProblems(permissions: Readonly<Record<string, string>> | undefined): string[] {
    return Object.keys(permissions ?? {})
        .filter((permission) => !isExtensionPermission(permission))
        .map((permission) =>
            permission.startsWith(NET_PREFIX)
                ? `${permission} does not name a host; write net:example.com`
                : `${permission} is not a permission this Ruimte knows (${EXTENSION_PERMISSIONS.join(', ')} or net:<host>)`
        );
}

/* The permission an action needs, or null for one an extension cannot name. */
export function extensionActionPermission(action: string): string | null {
    return Object.hasOwn(EXTENSION_ACTIONS, action) ? (EXTENSION_ACTIONS[action as ExtensionActionName] ?? null) : null;
}
