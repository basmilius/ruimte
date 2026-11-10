import type { LaunchConfigEntry } from './launches.ts';
import { isAbsolutePath, pathSeparatorOf } from './stored-path.ts';

/* A path with its `.` and `..` segments resolved and no separator left at the end, except a root's own. */
function collapsed(path: string): string {
    const root = /^(?:[a-zA-Z]:)?[\\/]*/.exec(path)![0];
    const separator = pathSeparatorOf(path);
    const segments: string[] = [];
    for (const segment of path.slice(root.length).split(/[\\/]+/)) {
        if (segment === '..') {
            segments.pop();
        } else if (segment !== '' && segment !== '.') {
            segments.push(segment);
        }
    }
    return root.replace(/[\\/]/g, separator) + segments.join(separator);
}

/*
 * Where a launch runs, absolute: its folder, or the private overlay's when a person set one, relative to the
 * project folder unless it names a root of its own. The daemon starts it there and the client sorts it by it.
 */
export function launchCwdOf(folder: string, launch: Pick<LaunchConfigEntry, 'cwd' | 'overlay'>): string {
    const cwd = (launch.overlay?.cwd ?? launch.cwd ?? '').trim();
    return collapsed(isAbsolutePath(cwd) ? cwd : `${folder}${pathSeparatorOf(folder)}${cwd}`);
}

/* What a launch lacks before it can start anything: the launches of a group, or the command of the rest. */
export function launchGap(launch: Pick<LaunchConfigEntry, 'kind' | 'command' | 'launches'>): 'members' | 'command' | null {
    if (launch.kind === 'group') {
        return (launch.launches ?? []).length === 0 ? 'members' : null;
    }
    return (launch.command ?? '').trim() === '' ? 'command' : null;
}
