import { expect, test } from 'bun:test';
import { downloadPlatform } from './download-platform';

test('only supported desktop systems get a suggested download', () => {
    expect(downloadPlatform('Mozilla Macintosh Mac OS X')).toBe('mac');
    expect(downloadPlatform('Mozilla X11 Linux x86_64')).toBe('appimage-x64');
    expect(downloadPlatform('Mozilla X11 Linux aarch64')).toBe('appimage-arm64');
    for (const agent of ['Windows NT 10.0', 'Linux Android', 'iPhone Mac OS X', 'Macintosh Mobile', 'Unknown']) {
        expect(downloadPlatform(agent)).toBeNull();
    }
});
