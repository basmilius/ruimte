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

/* The permission an action needs, or null for one an extension cannot name. */
export function extensionActionPermission(action: string): string | null {
    return Object.hasOwn(EXTENSION_ACTIONS, action) ? (EXTENSION_ACTIONS[action as ExtensionActionName] ?? null) : null;
}
