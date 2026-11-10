import { describe, expect, test } from 'bun:test';
import { PLATFORMS, type Platform } from './release.ts';

interface BuilderConfig {
    mac?: { artifactName?: string };
    dmg?: { artifactName?: string };
    linux: { artifactName: string; target: string[] };
    nsis: { artifactName: string };
}

const config = Bun.YAML.parse(await Bun.file(new URL('../../../desktop/electron-builder.yml', import.meta.url)).text()) as BuilderConfig;

/*
 * How electron-builder spells the architecture in a file name, per format. The names are the builder's own,
 * not the config's: only the template around them is set in `electron-builder.yml`.
 */
const LINUX_ARCH = {
    AppImage: { x64: 'x86_64', arm64: 'arm64' },
    deb: { x64: 'amd64', arm64: 'arm64' },
    rpm: { x64: 'x86_64', arm64: 'aarch64' }
} as const;

/* The part of a name after the version, the way the site finds its asset. */
function suffixOf(template: string, arch: string, ext: string): string {
    const afterVersion = template.slice(template.indexOf('${version}') + '${version}'.length);
    return afterVersion.replace('${arch}', arch).replace('${ext}', ext);
}

describe('the download suffixes of the site', () => {
    test('follow the artifact names of the desktop build', () => {
        const linux = config.linux.artifactName;
        const expected: Record<Platform, string> = {
            mac: '-arm64.dmg',
            'appimage-x64': suffixOf(linux, LINUX_ARCH.AppImage.x64, 'AppImage'),
            'appimage-arm64': suffixOf(linux, LINUX_ARCH.AppImage.arm64, 'AppImage'),
            'deb-x64': suffixOf(linux, LINUX_ARCH.deb.x64, 'deb'),
            'deb-arm64': suffixOf(linux, LINUX_ARCH.deb.arm64, 'deb'),
            'rpm-x64': suffixOf(linux, LINUX_ARCH.rpm.x64, 'rpm'),
            'rpm-arm64': suffixOf(linux, LINUX_ARCH.rpm.arm64, 'rpm'),
            windows: suffixOf(config.nsis.artifactName, 'x64', 'exe')
        };

        const actual: Record<string, string> = Object.fromEntries(Object.entries(PLATFORMS).map(([platform, entry]) => [platform, entry.suffix]));

        expect(actual).toEqual(expected);
    });

    test('rest on a Linux template that names the version and the architecture, and on the builder default for the disk image', () => {
        expect(config.linux.artifactName).toContain('${version}');
        expect(config.linux.artifactName).toContain('${arch}');
        expect(config.mac?.artifactName).toBeUndefined();
        expect(config.dmg?.artifactName).toBeUndefined();
        expect(config.linux.target).toEqual(['AppImage', 'deb', 'rpm']);
    });
});
