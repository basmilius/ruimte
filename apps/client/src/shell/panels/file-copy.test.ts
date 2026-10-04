import { describe, expect, test } from 'bun:test';
import type { DesktopBridge } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { canCopyFilesOn, copiedText, copyableFiles, type CopyTarget } from './file-copy.ts';

const targets: CopyTarget[] = [
    { absolute: '/work/app/src/main.ts', relative: 'src/main.ts' },
    { absolute: '/work/app/docs', relative: 'docs' },
    { absolute: '/work/app/old.ts', relative: 'old.ts', gone: true }
];

function bridge(copyFiles?: DesktopBridge['copyFiles']): DesktopBridge {
    return { platform: 'darwin', copyFiles } as DesktopBridge;
}

describe('copiedText', () => {
    test('a line per target for names, paths and relative paths', () => {
        expect(copiedText('/work/app', targets, 'name')).toBe('main.ts\ndocs\nold.ts');
        expect(copiedText('/work/app', targets, 'path')).toBe('/work/app/src/main.ts\n/work/app/docs\n/work/app/old.ts');
        expect(copiedText('/work/app', targets, 'relative')).toBe('src/main.ts\ndocs\nold.ts');
    });

    test('mentions go on one line and leave out a file that is gone', () => {
        expect(copiedText('/work/app', targets, 'mention')).toBe('@src/main.ts @docs');
    });

    test('nothing to copy when no target has the kind', () => {
        expect(copiedText(null, targets, 'mention')).toBeNull();
        expect(copiedText('/work/app', [{ absolute: '/elsewhere/a.ts', relative: null }], 'relative')).toBeNull();
    });
});

describe('copyableFiles', () => {
    test('every target that is still there', () => {
        expect(copyableFiles(targets)).toEqual(['/work/app/src/main.ts', '/work/app/docs']);
    });
});

describe('canCopyFilesOn', () => {
    test('only a project on this computer, in a shell that can put files on the clipboard', () => {
        const copyFiles = async (): Promise<boolean> => true;
        expect(canCopyFilesOn(LOCAL_ENDPOINT_ID, bridge(copyFiles))).toBe(true);
        expect(canCopyFilesOn('machine-2', bridge(copyFiles))).toBe(false);
        expect(canCopyFilesOn(LOCAL_ENDPOINT_ID, bridge())).toBe(false);
        expect(canCopyFilesOn(LOCAL_ENDPOINT_ID, null)).toBe(false);
    });
});
