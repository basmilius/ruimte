import { afterEach, describe, expect, test } from 'bun:test';
import type { DesktopBridge } from '@/desktop/bridge';
import { isQuickLookKey, QuickLook, quickLookShell, type QuickLookShell } from './quick-look';

/* A shell that records what it was asked and answers each show with `answer`. */
function recordingShell(answer: (path: string) => Promise<boolean> = async () => true): QuickLookShell & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        previewFile: (path) => {
            calls.push(`show ${path}`);
            return answer(path);
        },
        closeFilePreview: () => {
            calls.push('close');
        }
    };
}

const SPACE = { key: ' ', repeat: false, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false };

describe('quick look key', () => {
    test('only a bare Space that is not held down', () => {
        expect(isQuickLookKey(SPACE)).toBe(true);
        expect(isQuickLookKey({ ...SPACE, repeat: true })).toBe(false);
        expect(isQuickLookKey({ ...SPACE, metaKey: true })).toBe(false);
        expect(isQuickLookKey({ ...SPACE, ctrlKey: true })).toBe(false);
        expect(isQuickLookKey({ ...SPACE, shiftKey: true })).toBe(false);
        expect(isQuickLookKey({ ...SPACE, altKey: true })).toBe(false);
        expect(isQuickLookKey({ ...SPACE, key: 'Enter' })).toBe(false);
    });
});

describe('quick look', () => {
    test('Space shows the file and Space again closes it', () => {
        const shell = recordingShell();
        const quickLook = new QuickLook(shell);
        quickLook.toggle('/work/a.png');
        expect(quickLook.open).toBe(true);
        quickLook.toggle('/work/a.png');
        expect(quickLook.open).toBe(false);
        expect(shell.calls).toEqual(['show /work/a.png', 'close']);
    });

    test('moving the focus moves an open Quick Look along and leaves a closed one closed', () => {
        const shell = recordingShell();
        const quickLook = new QuickLook(shell);
        quickLook.follow('/work/a.png');
        quickLook.toggle('/work/a.png');
        quickLook.follow('/work/a.png');
        quickLook.follow('/work/b.pdf');
        expect(shell.calls).toEqual(['show /work/a.png', 'show /work/b.pdf']);
    });

    test('closing answers whether there was one to close', () => {
        const shell = recordingShell();
        const quickLook = new QuickLook(shell);
        expect(quickLook.close()).toBe(false);
        quickLook.toggle('/work/a.png');
        expect(quickLook.close()).toBe(true);
        expect(shell.calls).toEqual(['show /work/a.png', 'close']);
    });

    test('once the window has the keyboard back, the next Space shows the file again', () => {
        const shell = recordingShell();
        const quickLook = new QuickLook(shell);
        quickLook.toggle('/work/a.png');
        quickLook.released();
        quickLook.toggle('/work/a.png');
        expect(shell.calls).toEqual(['show /work/a.png', 'show /work/a.png']);
    });

    test('a file the shell refuses leaves Quick Look closed', async () => {
        const quickLook = new QuickLook(recordingShell(async () => false));
        quickLook.toggle('/elsewhere/a.png');
        await Promise.resolve();
        await Promise.resolve();
        expect(quickLook.open).toBe(false);
    });

    test('a refusal of an earlier file does not close the one shown after it', async () => {
        const quickLook = new QuickLook(recordingShell(async (path) => path !== '/work/gone.png'));
        quickLook.toggle('/work/gone.png');
        quickLook.follow('/work/b.pdf');
        await Promise.resolve();
        await Promise.resolve();
        expect(quickLook.open).toBe(true);
    });
});

describe('quick look shell', () => {
    const globals = globalThis as { window?: { ruimteDesktop?: Partial<DesktopBridge> } };
    const before = globals.window;

    afterEach(() => {
        globals.window = before;
    });

    function withBridge(bridge: Partial<DesktopBridge>): void {
        globals.window = { ruimteDesktop: bridge };
    }

    const quickLookMethods = { previewFile: async () => true, closeFilePreview: () => undefined };

    test('is offered on macOS for a project on this machine', () => {
        withBridge({ platform: 'darwin', ...quickLookMethods });
        expect(quickLookShell('local')).not.toBeNull();
    });

    test('a file on another machine gets none', () => {
        withBridge({ platform: 'darwin', ...quickLookMethods });
        expect(quickLookShell('abc123')).toBeNull();
    });

    test('a shell without the methods or off macOS offers none', () => {
        withBridge({ platform: 'darwin' });
        expect(quickLookShell('local')).toBeNull();
        withBridge({ platform: 'linux', ...quickLookMethods });
        expect(quickLookShell('local')).toBeNull();
        globals.window = undefined;
        expect(quickLookShell('local')).toBeNull();
    });
});
