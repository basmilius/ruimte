// The fuses of the packaged app. No part of the shell runs Electron as Node: the daemon is a Bun
// executable, and the dev app runs the unflipped Electron from node_modules.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const FUSES = {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true
};

// The order of Electron's first fuse wire, after a sentinel, a version byte and a length byte.
const WIRE_ORDER = [
    'runAsNode',
    'enableCookieEncryption',
    'enableNodeOptionsEnvironmentVariable',
    'enableNodeCliInspectArguments',
    'enableEmbeddedAsarIntegrityValidation',
    'onlyLoadAppFromAsar',
    'loadBrowserProcessSpecificV8Snapshot',
    'grantFileProtocolExtraPrivileges'
];
const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const STATES = { 0x30: false, 0x31: true, 0x72: 'removed' };

/* Each fuse a binary's wire names, as true, false or 'removed'. */
function readFuseWire(bytes) {
    const at = bytes.indexOf(SENTINEL);
    if (at === -1) {
        throw new Error('No fuse wire in this binary');
    }
    const wire = at + SENTINEL.length;
    if (bytes[wire] !== 1) {
        throw new Error(`Fuse wire version ${bytes[wire]} is not the one this check reads`);
    }
    const length = bytes[wire + 1];
    const fuses = {};
    for (let i = 0; i < length && i < WIRE_ORDER.length; i++) {
        fuses[WIRE_ORDER[i]] = STATES[bytes[wire + 2 + i]];
    }
    return fuses;
}

/* What differs from `FUSES`, one line per fuse. */
function fuseProblems(fuses) {
    return Object.entries(FUSES)
        .filter(([name, wanted]) => fuses[name] !== wanted)
        .map(([name, wanted]) => `${name} is ${String(fuses[name])}, not ${String(wanted)}`);
}

/* The file whose wire Electron reads: on macOS the framework, elsewhere the executable. */
function fuseFileOf(context) {
    const { appOutDir, electronPlatformName, packager } = context;
    if (electronPlatformName === 'darwin') {
        return join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework');
    }
    if (electronPlatformName === 'win32') {
        return join(appOutDir, `${packager.appInfo.productFilename}.exe`);
    }
    return join(appOutDir, packager.executableName);
}

/*
 * Flips the fuses and reads them back, so a package where one did not take never reaches signing or
 * an upload. Not through `electronFuses`, which flips after the last hook that runs on every platform.
 */
async function applyFuses(context) {
    const config = await context.packager.generateFuseConfig({ ...FUSES, resetAdHocDarwinSignature: context.electronPlatformName === 'darwin' });
    await context.packager.addElectronFuses(context, config);
    const problems = fuseProblems(readFuseWire(readFileSync(fuseFileOf(context))));
    if (problems.length > 0) {
        throw new Error(`The packaged app's fuses are not as set: ${problems.join('; ')}`);
    }
}

module.exports = { FUSES, applyFuses, fuseProblems, readFuseWire };
