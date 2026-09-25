import { describe, expect, test } from 'bun:test';
import { assetUrl, availablePlatforms, parseRelease } from './release.ts';

const asset = (name: string) => ({ name, browser_download_url: `https://github.com/basmilius/ruimte/releases/download/v0.6.0/${name}` });

const answer = {
    tag_name: 'v0.6.0',
    published_at: '2026-09-25T14:18:06Z',
    assets: [
        asset('latest-mac.yml'),
        asset('Ruimte-0.6.0-arm64-mac.zip'),
        asset('Ruimte-0.6.0-arm64.dmg'),
        asset('Ruimte-0.6.0-arm64.dmg.blockmap'),
        asset('Ruimte-0.6.0-x86_64.AppImage'),
        asset('Ruimte-0.6.0-arm64.AppImage'),
        asset('Ruimte-0.6.0-amd64.deb'),
        asset('Ruimte-0.6.0-arm64.deb'),
        asset('Ruimte-0.6.0-x86_64.rpm')
    ]
};

describe('parseRelease', () => {
    test('drops the v from the tag', () => {
        expect(parseRelease(answer)?.version).toBe('0.6.0');
    });

    test('refuses an answer without a tag', () => {
        expect(parseRelease({ message: 'Not Found' })).toBeNull();
        expect(parseRelease(null)).toBeNull();
    });
});

describe('assetUrl', () => {
    const release = parseRelease(answer)!;

    test('picks the disk image for macOS, not its blockmap or the zip', () => {
        expect(assetUrl(release, 'mac')).toEndWith('/Ruimte-0.6.0-arm64.dmg');
    });

    test('tells the Linux architectures apart', () => {
        expect(assetUrl(release, 'appimage-x64')).toEndWith('/Ruimte-0.6.0-x86_64.AppImage');
        expect(assetUrl(release, 'deb-x64')).toEndWith('/Ruimte-0.6.0-amd64.deb');
        expect(assetUrl(release, 'deb-arm64')).toEndWith('/Ruimte-0.6.0-arm64.deb');
    });

    test('is null for a build the release does not have', () => {
        expect(assetUrl(release, 'rpm-arm64')).toBeNull();
        expect(availablePlatforms(release)).not.toContain('rpm-arm64');
    });
});
