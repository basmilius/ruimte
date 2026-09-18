import { runDeviceHelper } from './native-helper.ts';

const deviceId = process.argv[2];
if (!deviceId || process.argv.length !== 3) {
    console.error('Usage: ruimte-simulator-helper <device-id>');
    process.exit(2);
}

process.exit(await runDeviceHelper(deviceId));
