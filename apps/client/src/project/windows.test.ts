import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useWindow } from '@/state/window';
import type { Workspace } from '@/transport/connections';
import { NO_TABS, startWindowTabs, useWindowTabs, type TabsShell } from './window-tabs';
import { moveToNewWindow, tearOutTab, wantsNewWindow, type MoveDeps, type TearOutDeps } from './windows';

function spyMove(over: Partial<MoveDeps> = {}): { deps: Partial<MoveDeps>; steps: string[] } {
    const steps: string[] = [];
    return {
        steps,
        deps: {
            shell: {
                moveToNewWindow: async () => {
                    steps.push('move');
                    return true;
                }
            },
            hasProject: () => true,
            confirm: async () => true,
            flush: async () => {
                steps.push('flush');
            },
            leave: async () => {
                steps.push('leave');
            },
            toStart: () => {
                steps.push('start');
            },
            shownKey: () => 'local:a',
            showTab: async (key) => {
                steps.push(`show ${key}`);
            },
            ...over
        }
    };
}

describe('moving the project to a new window', () => {
    afterEach(() => useWindowTabs.setState({ tabs: NO_TABS }));

    test('with tabs the window goes on to the tab beside it, and the moved one leaves its tabs', async () => {
        useWindowTabs.setState({ tabs: { keys: ['local:a', 'local:b'], active: 'local:a' } });
        const { deps, steps } = spyMove();
        expect(await moveToNewWindow(deps)).toBe(true);
        expect(steps).toEqual(['flush', 'move', 'show local:b']);
        expect(useWindowTabs.getState().tabs.keys).toEqual(['local:b']);
    });

    test('hands the shell the point the new window goes to', async () => {
        const points: unknown[] = [];
        const { deps } = spyMove({
            shell: {
                moveToNewWindow: async (at) => {
                    points.push(at);
                    return true;
                }
            }
        });
        await moveToNewWindow({ ...deps, at: { x: 5, y: 6 } });
        expect(points).toEqual([{ x: 5, y: 6 }]);
    });

    test('writes what is on screen, hands the project over, and only then lets go of it', async () => {
        const { deps, steps } = spyMove();
        expect(await moveToNewWindow(deps)).toBe(true);
        expect(steps).toEqual(['flush', 'move', 'leave', 'start']);
    });

    test('a shell that did not hand it over leaves the window as it was', async () => {
        const { deps, steps } = spyMove({
            shell: {
                moveToNewWindow: async () => {
                    steps.push('move');
                    return false;
                }
            }
        });
        expect(await moveToNewWindow(deps)).toBe(false);
        expect(steps).toEqual(['flush', 'move']);
    });

    test('staying with a conflict moves nothing', async () => {
        const { deps, steps } = spyMove({ confirm: async () => false });
        expect(await moveToNewWindow(deps)).toBe(false);
        expect(steps).toEqual([]);
    });

    test('a save that cannot be written does not keep the project from moving', async () => {
        const { deps, steps } = spyMove({ flush: () => Promise.reject(new Error('conflict')) });
        expect(await moveToNewWindow(deps)).toBe(true);
        expect(steps).toEqual(['move', 'leave', 'start']);
    });

    test('nothing moves from the start screen or without a shell that keeps windows', async () => {
        expect(await moveToNewWindow(spyMove({ hasProject: () => false }).deps)).toBe(false);
        expect(await moveToNewWindow(spyMove({ shell: null }).deps)).toBe(false);
        expect(await moveToNewWindow(spyMove({ shell: {} }).deps)).toBe(false);
    });
});

function show(projectId: string | null): void {
    if (projectId === null) {
        useWindow.setState({ content: { kind: 'start' } });
        useProject.setState({ current: null, currentEndpointId: null });
        return;
    }
    useWindow.setState({ content: { kind: 'workspace', workspace: {} as Workspace } });
    useProject.setState({ current: { projectId, name: projectId } as ProjectSummary, currentEndpointId: 'local' });
}

/*
 * The shell's side of a window as it stands: it detaches only a project the window shows or keeps,
 * and hears both over one channel, in the order the page sent them.
 */
function windowShell(shown: string, refuse = false): TabsShell & Pick<TearOutDeps, 'shell'> & { heard: string[] } {
    const heard: string[] = [];
    let kept: string[] = [];
    const shell = {
        heard,
        holdTabs: async (keys: string[]) => {
            heard.push(`hold ${keys.join(' ')}`);
            kept = [...keys];
            return keys;
        },
        tabDrag: async (phase: 'start' | 'end', key: string) => {
            const has = key === shown || kept.includes(key);
            heard.push(`${phase} ${key} ${has && !refuse ? 'detached' : 'refused'}`);
            kept = kept.filter((one) => one !== key);
            return has && !refuse;
        }
    };
    return { ...shell, shell };
}

describe('tearing a tab out of the window', () => {
    let stop: (() => void) | null = null;
    const previousNavigation = useSettings.getState().projectNavigation;

    afterEach(() => {
        stop?.();
        stop = null;
        show(null);
        useSettings.setState({ projectNavigation: previousNavigation });
    });

    async function windowWith(projects: string[], shell: TabsShell): Promise<void> {
        useSettings.setState({ projectNavigation: 'tabs' });
        stop = startWindowTabs({
            place: null,
            shell: () => shell,
            open: () => undefined,
            switches: async () => ({ busy: () => false, subscribe: () => () => undefined })
        });
        for (const project of projects) {
            show(project);
        }
        await Promise.resolve();
    }

    function spyTearOut(shell: TearOutDeps['shell'], shownKey: string): { deps: Partial<TearOutDeps>; steps: string[] } {
        const { deps, steps } = spyMove({ shownKey: () => shownKey });
        return { deps: { ...deps, shell }, steps };
    }

    test('a tab in the back goes into a window of its own, and the window keeps showing its project', async () => {
        const shell = windowShell('local:b');
        await windowWith(['a', 'b'], shell);
        const { deps, steps } = spyTearOut(shell.shell, 'local:b');
        expect(await tearOutTab('local:a', { x: 10, y: 10 }, 80, deps)).toBe(true);
        expect(shell.heard.at(-1)).toBe('start local:a detached');
        expect(steps).toEqual([]);
        expect(useWindowTabs.getState().tabs).toEqual({ keys: ['local:b'], active: 'local:b' });
    });

    test('the tab on screen goes with what it shows, and the window goes on to the tab beside it', async () => {
        const shell = windowShell('local:b');
        await windowWith(['a', 'b'], shell);
        const { deps, steps } = spyTearOut(shell.shell, 'local:b');
        expect(await tearOutTab('local:b', { x: 10, y: 10 }, 80, deps)).toBe(true);
        expect(shell.heard.at(-1)).toBe('start local:b detached');
        expect(steps).toEqual(['flush', 'show local:a']);
        expect(useWindowTabs.getState().tabs.keys).toEqual(['local:a']);
    });

    test('a tab the shell does not detach comes back where it was', async () => {
        const shell = windowShell('local:b', true);
        await windowWith(['a', 'b'], shell);
        const { deps, steps } = spyTearOut(shell.shell, 'local:b');
        expect(await tearOutTab('local:a', { x: 10, y: 10 }, 80, deps)).toBe(false);
        expect(steps).toEqual([]);
        expect(useWindowTabs.getState().tabs).toEqual({ keys: ['local:a', 'local:b'], active: 'local:b' });
        expect(shell.heard.at(-1)).toBe('hold local:a local:b');
    });

    test('nothing tears out without a shell that follows the pointer', async () => {
        await windowWith(['a', 'b'], windowShell('local:b'));
        const { deps } = spyTearOut(null, 'local:b');
        expect(await tearOutTab('local:a', { x: 10, y: 10 }, 80, deps)).toBe(false);
        expect(useWindowTabs.getState().tabs.keys).toEqual(['local:a', 'local:b']);
    });
});

describe('wantsNewWindow', () => {
    const shell = { openWindow: () => undefined };

    test('is Cmd on macOS and Ctrl elsewhere', () => {
        expect(wantsNewWindow({ metaKey: true, ctrlKey: false }, true, shell)).toBe(true);
        expect(wantsNewWindow({ metaKey: false, ctrlKey: true }, true, shell)).toBe(false);
        expect(wantsNewWindow({ metaKey: false, ctrlKey: true }, false, shell)).toBe(true);
        expect(wantsNewWindow({ metaKey: true, ctrlKey: false }, false, shell)).toBe(false);
    });

    test('is never true where no shell opens windows', () => {
        expect(wantsNewWindow({ metaKey: true, ctrlKey: true }, true, null)).toBe(false);
    });
});
