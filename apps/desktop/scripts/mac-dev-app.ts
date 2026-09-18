import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const BUNDLE_ID = 'app.ruimte.desktop.rust-dev';
const BUNDLE_NAME = 'Ruimte Rust Dev';
const MICROPHONE_REASON = 'Ruimte uses the microphone only while you test it or run a GPT-Live conversation.';
const DEV_BUNDLE_REVISION = '3';

const replacePlistString = (plist: string, key: string, value: string): void => {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
};

export const prepareMacDevelopmentApp = (electronExecutable: string, outputDirectory: string): string => {
    const sourceBundle = resolve(dirname(electronExecutable), '..', '..');
    const targetBundle = join(outputDirectory, `${BUNDLE_NAME}.app`);
    const sourcePlist = join(sourceBundle, 'Contents', 'Info.plist');
    const targetPlist = join(targetBundle, 'Contents', 'Info.plist');
    const marker = join(outputDirectory, '.ruimte-dev-app');
    const sourceVersion = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', sourcePlist], { encoding: 'utf8' }).trim();
    const expectedMarker = `${DEV_BUNDLE_REVISION}:${sourceVersion}`;

    if (!existsSync(targetBundle) || !existsSync(marker) || readFileSync(marker, 'utf8') !== expectedMarker) {
        rmSync(targetBundle, { recursive: true, force: true });
        cpSync(sourceBundle, targetBundle, { recursive: true, verbatimSymlinks: true });
        replacePlistString(targetPlist, 'CFBundleIdentifier', BUNDLE_ID);
        replacePlistString(targetPlist, 'CFBundleName', BUNDLE_NAME);
        replacePlistString(targetPlist, 'CFBundleDisplayName', BUNDLE_NAME);
        replacePlistString(targetPlist, 'NSMicrophoneUsageDescription', MICROPHONE_REASON);
        replacePlistString(targetPlist, 'NSAudioCaptureUsageDescription', MICROPHONE_REASON);
        execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', targetBundle]);
        writeFileSync(marker, expectedMarker);
    }

    return join(targetBundle, 'Contents', 'MacOS', 'Electron');
};
