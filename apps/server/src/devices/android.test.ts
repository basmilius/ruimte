import { describe, expect, test } from 'bun:test';
import type { DeviceAction } from '@ruimte/contracts';
import { FakeRecorder } from './device-test-helpers.ts';
import type { DeviceSource } from './manager.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    AndroidBackend,
    batteryOf,
    hingeOf,
    parseAdbDevices,
    readAvdFolder,
    shellQuote,
    type AndroidBackendOptions,
    type AvdInfo,
    type EmulatorProcess
} from './android.ts';

const SDK = { adb: '/sdk/platform-tools/adb', emulator: '/sdk/emulator/emulator', avdHome: '/home/.android/avd' };
const PIXEL: AvdInfo = { name: 'Pixel_9_Pro_API_35', displayName: 'Pixel 9 Pro API 35', apiLevel: '35' };
const TABLET: AvdInfo = { name: 'Tablet_API_34', displayName: 'Tablet API 34', apiLevel: '34' };

const PROBE_BOOTED = '1\nsdk_gphone64_arm64\n35\npackage:/product/app/talkback/talkback.apk\n';

/* A device side that answers adb the way a running emulator and a phone do. */
class FakeAdb {
    readonly calls: string[][] = [];
    devices = 'List of devices attached\nemulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 transport_id:2\n';
    readonly shell = new Map<string, string>();
    readonly execOut = new Map<string, string>();
    failing = new Set<string>();

    run = async (_command: string, arguments_: string[]) => {
        this.calls.push(arguments_);
        const joined = arguments_.join(' ');
        if (this.failing.has(joined)) {
            return { exitCode: 1, stdout: '', stderr: `Failure: ${joined}` };
        }
        if (joined === 'devices -l') {
            return { exitCode: 0, stdout: this.devices, stderr: '' };
        }
        if (joined === 'emu avd name' || joined.endsWith(' emu avd name')) {
            return { exitCode: 0, stdout: 'Pixel_9_Pro_API_35\r\nOK\r\n', stderr: '' };
        }
        if (arguments_[2] === 'shell') {
            const script = arguments_[3]!;
            if (script.startsWith('getprop sys.boot_completed')) {
                return { exitCode: 0, stdout: arguments_[1] === 'R5CT' ? '1\nSM-S921B\n34\n' : PROBE_BOOTED, stderr: '' };
            }
            return { exitCode: 0, stdout: this.shell.get(script) ?? '', stderr: '' };
        }
        if (arguments_[2] === 'exec-out') {
            return { exitCode: 0, stdout: this.execOut.get(arguments_.slice(3).join(' ')) ?? '', stderr: '' };
        }
        return { exitCode: 0, stdout: 'OK\n', stderr: '' };
    };
}

function backendWith(adb: FakeAdb, options: AndroidBackendOptions = {}): AndroidBackend {
    return new AndroidBackend({
        locate: () => SDK,
        run: adb.run,
        readAvds: async () => [PIXEL, TABLET],
        createSource: () => ({}) as DeviceSource,
        sleep: async () => undefined,
        ...options
    });
}

describe('parseAdbDevices', () => {
    test('reads states, the model and a sentence for a state', () => {
        expect(
            parseAdbDevices(
                [
                    '* daemon started successfully',
                    'List of devices attached',
                    'R5CT       device usb:1-1 product:e1q model:SM_S921B device:e1q transport_id:3',
                    '0A281FDD   unauthorized usb:1-2 transport_id:4',
                    'HT7A1      no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html]',
                    ''
                ].join('\n')
            )
        ).toEqual([
            { serial: 'R5CT', state: 'device', model: 'SM S921B' },
            { serial: '0A281FDD', state: 'unauthorized', model: null },
            { serial: 'HT7A1', state: 'no-permissions', model: null }
        ]);
    });
});

describe('shellQuote', () => {
    test('passes plain words and quotes the rest for the device shell', () => {
        expect(shellQuote('com.example.app')).toBe('com.example.app');
        expect(shellQuote("https://ruimte.app/?a=1&b='2'")).toBe("'https://ruimte.app/?a=1&b='\\''2'\\'''");
    });
});

const USB_CHARGING = [
    'Current Battery Service state:',
    '  AC powered: false',
    '  USB powered: true',
    '  Wireless powered: false',
    '  Max charging current: 500000',
    '  status: 2',
    '  health: 2',
    '  present: true',
    '  level: 82',
    '  scale: 100',
    '  voltage: 4123',
    '  technology: Li-ion'
].join('\n');

describe('batteryOf', () => {
    test('reads a phone that charges over USB', () => {
        expect(batteryOf(USB_CHARGING)).toEqual({ level: 82, plugged: true, charging: true, source: 'usb' });
    });

    test('reads a phone on its battery, and one full on AC that no longer charges', () => {
        expect(batteryOf(USB_CHARGING.replace('USB powered: true', 'USB powered: false').replace('status: 2', 'status: 3'))).toEqual({
            level: 82,
            plugged: false,
            charging: false
        });
        expect(
            batteryOf(
                USB_CHARGING.replace('AC powered: false', 'AC powered: true')
                    .replace('USB powered: true', 'USB powered: false')
                    .replace('status: 2', 'status: 5')
                    .replace('level: 82', 'level: 100')
            )
        ).toEqual({ level: 100, plugged: true, charging: false, source: 'ac' });
    });

    test('scales a level that is not out of 100', () => {
        expect(batteryOf(USB_CHARGING.replace('level: 82', 'level: 41').replace('scale: 100', 'scale: 50'))?.level).toBe(82);
    });

    test('calls a level someone set with dumpsys simulated, and a dump without a level unknown', () => {
        expect(
            batteryOf(USB_CHARGING.replace('Current Battery Service state:', "Current Battery Service state:\n  (UPDATES STOPPED -- use 'reset' to restart)"))
                ?.simulated
        ).toBe(true);
        expect(batteryOf("Can't find service: battery")).toBeNull();
    });
});

describe('AndroidBackend', () => {
    test('reads the battery of a phone, says a fake level is simulated, and has none for an emulator', async () => {
        const adb = new FakeAdb();
        adb.devices += 'R5CT device usb:1-1 model:SM_S921B transport_id:3\n';
        adb.shell.set('dumpsys battery', USB_CHARGING);
        const backend = backendWith(adb);
        await backend.list();

        expect(await backend.power('R5CT')).toEqual({ level: 82, plugged: true, charging: true, source: 'usb' });
        expect(await backend.power('Pixel_9_Pro_API_35')).toBeNull();

        await backend.action('R5CT', { backendId: 'android', platform: 'android', deviceId: 'R5CT', action: 'setBattery', level: 15, charging: false });
        adb.calls.length = 0;
        expect(await backend.power('R5CT')).toEqual({ level: 15, plugged: false, charging: false, simulated: true });
        expect(adb.calls.some((call) => call.includes('dumpsys battery'))).toBe(false);
    });

    test('lists every AVD by its name, running or not, and phones by their serial', async () => {
        const adb = new FakeAdb();
        adb.devices += 'R5CT device usb:1-1 model:SM_S921B transport_id:3\n0A281FDD unauthorized usb:1-2 transport_id:4\n';
        const devices = await backendWith(adb).list();

        expect(devices.map((device) => [device.deviceId, device.kind, device.name, device.runtime, device.state, device.reason])).toEqual([
            ['R5CT', 'physical', 'SM-S921B', 'API 34', 'booted', undefined],
            ['0A281FDD', 'physical', 'Android device', 'Android', 'shutdown', 'unauthorized'],
            ['Pixel_9_Pro_API_35', 'simulator', 'Pixel 9 Pro API 35', 'API 35', 'booted', undefined],
            ['Tablet_API_34', 'simulator', 'Tablet API 34', 'API 34', 'shutdown', undefined]
        ]);
        expect(devices[2]!.capabilities).toMatchObject({
            boot: true,
            shutdown: true,
            stream: true,
            input: true,
            buttons: ['back', 'home', 'appSwitcher', 'lock', 'siri', 'volumeUp', 'volumeDown', 'playPause']
        });
        expect(devices[2]!.capabilities.tools).toContain('voiceOver');
        expect(devices[2]!.capabilities.tools).toContain('location');
        expect(devices[0]!.capabilities.tools).not.toContain('location');
        expect(devices[1]!.capabilities).toMatchObject({ stream: false, input: false, screenshot: false });
        expect(devices[0]!.capabilities.screenshot).toBe(true);
        expect(devices[2]!.capabilities.screenshot).toBe(true);
    });

    test('photographs a running device through adb as the bytes of a png', async () => {
        const adb = new FakeAdb();
        const captured: string[][] = [];
        const backend = backendWith(adb, {
            runBytes: async (_command, arguments_) => {
                captured.push(arguments_);
                return { exitCode: 0, stdout: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), stderr: '' };
            }
        });

        expect(await backend.screenshot('Pixel_9_Pro_API_35')).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
        expect(captured).toEqual([['-s', 'emulator-5554', 'exec-out', 'screencap', '-p']]);
        await expect(backend.screenshot('Tablet_API_34')).rejects.toMatchObject({ code: 'device-not-booted' });
    });

    test('pastes text of any script through the session clipboard, a newline as Enter, waiting after each paste, and never through the shell', async () => {
        const adb = new FakeAdb();
        const events: string[] = [];
        const backend = backendWith(adb, {
            sleep: async (ms) => {
                events.push(`sleep ${ms}`);
            }
        });
        const before = adb.calls.length;

        await backend.type('Pixel_9_Pro_API_35', "Grüße 🎉 привет 你好 it's $HOME; rm -rf /\r\nnext\tlast", async () => ({
            keys: async (usages) => {
                events.push(`keys ${usages.join(',')}`);
            },
            paste: async (run) => {
                events.push(`paste <${run}>`);
            }
        }));

        expect(events).toEqual([
            "paste <Grüße 🎉 привет 你好 it's $HOME; rm -rf />",
            'sleep 150',
            'keys 40',
            'paste <next>',
            'sleep 150',
            'keys 43',
            'paste <last>',
            'sleep 150'
        ]);
        expect(adb.calls.length).toBe(before);
    });

    test('says why a screen could not be captured', async () => {
        const backend = backendWith(new FakeAdb(), { runBytes: async () => ({ exitCode: 1, stdout: new Uint8Array(), stderr: 'error: closed' }) });

        await expect(backend.screenshot('Pixel_9_Pro_API_35')).rejects.toMatchObject({ code: 'device-capture-failed', message: 'error: closed' });
    });

    test('asks a device about itself once it finished booting', async () => {
        const adb = new FakeAdb();
        const backend = backendWith(adb);
        await backend.list();
        await backend.list();

        expect(adb.calls.filter((call) => call.includes('emu') || call[2] === 'shell')).toHaveLength(2);
    });

    test('says the SDK is missing', async () => {
        await expect(new AndroidBackend({ locate: () => null }).list()).rejects.toMatchObject({ code: 'adb-unavailable' });
    });

    test('starts an emulator without a window on a free port and reads it as starting', async () => {
        const adb = new FakeAdb();
        const launches: string[][] = [];
        const backend = backendWith(adb, {
            launch: (_emulator, arguments_) => {
                launches.push(arguments_);
                adb.devices += 'emulator-5556 offline\n';
                return { exited: new Promise<number>(() => undefined), output: () => '' };
            }
        });

        const device = await backend.boot('Tablet_API_34');

        expect(launches).toEqual([['-avd', 'Tablet_API_34', '-port', '5556', '-no-window', '-no-boot-anim']]);
        expect(device).toMatchObject({ deviceId: 'Tablet_API_34', state: 'transitioning' });
    });

    test('says why an emulator stopped while starting', async () => {
        let exit: (code: number) => void = () => undefined;
        const process: EmulatorProcess = {
            exited: new Promise<number>((resolve) => {
                exit = resolve;
            }),
            output: () => 'INFO | starting\nERROR | x86_64 emulation currently requires hardware acceleration!\n'
        };
        const backend = backendWith(new FakeAdb(), {
            launch: () => {
                exit(1);
                return process;
            }
        });

        await expect(backend.boot('Tablet_API_34')).rejects.toMatchObject({
            code: 'emulator-failed',
            message: 'ERROR | x86_64 emulation currently requires hardware acceleration!'
        });
    });

    test('stops a running emulator through its console', async () => {
        const adb = new FakeAdb();
        const backend = backendWith(adb);
        await backend.list();
        const stopped = backend.shutdown('Pixel_9_Pro_API_35');
        adb.devices = 'List of devices attached\n';

        expect(await stopped).toMatchObject({ state: 'shutdown' });
        expect(adb.calls).toContainEqual(['-s', 'emulator-5554', 'emu', 'kill']);
    });

    test('reads the settings the tools show', async () => {
        const adb = new FakeAdb();
        const detail = [
            'cmd uimode night',
            'settings get system font_scale',
            'settings get global window_animation_scale',
            'settings get global transition_animation_scale',
            'settings get global animator_duration_scale',
            'settings get secure high_text_contrast_enabled',
            'settings get secure accessibility_display_daltonizer_enabled',
            'settings get secure accessibility_display_daltonizer',
            'getprop debug.layout',
            'settings get secure enabled_accessibility_services'
        ].join('; echo @@; ');
        adb.shell.set(
            detail,
            [
                'Night mode: yes',
                '1.15',
                '0.0',
                '0',
                '0',
                '1',
                '1',
                '12',
                'true',
                'com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService'
            ].join('\n@@\n')
        );

        expect(await backendWith(adb).detail('Pixel_9_Pro_API_35')).toEqual({
            appearance: 'dark',
            textSize: 'large',
            reduceMotion: true,
            increaseContrast: true,
            colorFilter: 'green-red',
            showBorders: true,
            voiceOver: true,
            recording: false
        });
    });

    test('runs tools as quoted shell commands and the location through the emulator console', async () => {
        const adb = new FakeAdb();
        const backend = backendWith(adb);
        const target = { backendId: 'android', platform: 'android', deviceId: 'Pixel_9_Pro_API_35' } as const;
        adb.failing.add('-s emulator-5554 shell pm grant com.example.app android.permission.WRITE_CONTACTS');

        await backend.action('Pixel_9_Pro_API_35', { ...target, action: 'openUrl', url: 'https://ruimte.app/?a=1&b=2' });
        await backend.action('Pixel_9_Pro_API_35', { ...target, action: 'setLocation', latitude: 52.37, longitude: 4.89 });
        await backend.action('Pixel_9_Pro_API_35', { ...target, action: 'setPermission', appId: 'com.example.app', permission: 'contacts', decision: 'grant' });

        const shells = adb.calls.filter((call) => call[2] === 'shell').map((call) => call[3]);
        expect(shells).toContain("am start -a android.intent.action.VIEW -d 'https://ruimte.app/?a=1&b=2'");
        expect(shells).toContain('pm grant com.example.app android.permission.READ_CONTACTS');
        expect(adb.calls).toContainEqual(['-s', 'emulator-5554', 'emu', 'geo', 'fix', '4.89', '52.37']);
        await expect(backend.action('Pixel_9_Pro_API_35', { ...target, action: 'launchApp', appId: 'rm -rf /' })).rejects.toMatchObject({
            code: 'device-action-unavailable'
        });
        await expect(backend.action('Pixel_9_Pro_API_35', { ...target, action: 'sendPush', appId: 'com.example.app', payload: 'Hi' })).rejects.toMatchObject({
            code: 'device-action-unavailable'
        });
    });

    test('reads the elements of the screen from uiautomator, in pixels of a display it asked the size of', async () => {
        const adb = new FakeAdb();
        adb.shell.set('wm size', 'Physical size: 1080x2400\n');
        adb.execOut.set(
            'uiautomator dump /dev/tty',
            '<?xml version=\'1.0\' ?><hierarchy rotation="0"><node class="android.widget.Button" package="com.example" text="Pay" resource-id="com.example:id/pay" clickable="true" enabled="true" bounds="[40,2000][1040,2200]" /></hierarchy>UI hierchary dumped to: /dev/tty'
        );
        const tree = await backendWith(adb).tree('Pixel_9_Pro_API_35');
        expect(tree.screen).toEqual({ width: 1080, height: 2400 });
        expect(tree.root.children).toEqual([
            {
                role: 'Button',
                subrole: null,
                label: 'Pay',
                value: null,
                identifier: 'com.example:id/pay',
                frame: { x: 40, y: 2000, width: 1000, height: 200 },
                enabled: true,
                children: []
            }
        ]);
        expect(adb.calls.some((call) => call.includes('/data/local/tmp/ruimte-window.xml'))).toBe(false);
    });

    test('dumps to a file on a device that cannot write to its own output, and says why when there is no tree at all', async () => {
        const adb = new FakeAdb();
        const script =
            'uiautomator dump /data/local/tmp/ruimte-window.xml >/dev/null && cat /data/local/tmp/ruimte-window.xml; rm -f /data/local/tmp/ruimte-window.xml';
        adb.shell.set('wm size', 'Physical size: 1080x2400\n');
        adb.execOut.set('uiautomator dump /dev/tty', 'java.io.FileNotFoundException: /dev/tty');
        adb.shell.set(script, '<hierarchy rotation="0"><node class="android.widget.TextView" text="Hi" bounds="[0,0][10,10]" /></hierarchy>');
        const backend = backendWith(adb);
        expect((await backend.tree('Pixel_9_Pro_API_35')).root.children[0]?.label).toBe('Hi');
        adb.shell.set(script, 'ERROR: could not get idle state.');
        await expect(backend.tree('Pixel_9_Pro_API_35')).rejects.toMatchObject({
            code: 'device-tree-failed',
            message: expect.stringContaining('could not get idle state')
        });
        await expect(backend.tree('Tablet_API_34')).rejects.toMatchObject({ code: 'device-not-booted' });
    });

    test('records through the device recorder, interrupts it on the device, then pulls the video and removes it there', async () => {
        const adb = new FakeAdb();
        const recorder = new FakeRecorder();
        const answer = adb.run;
        const interrupt = '-s emulator-5554 shell pkill -INT screenrecord';
        const backend = backendWith(adb, {
            recordings: recorder.recordings(),
            run: async (command, arguments_) => {
                if (arguments_.join(' ') === interrupt) {
                    recorder.finish(0);
                }
                return answer(command, arguments_);
            }
        });

        await backend.startRecording('Pixel_9_Pro_API_35', '/captures/Pixel-1.mp4');
        expect(recorder.commands).toEqual([[SDK.adb, '-s', 'emulator-5554', 'shell', 'screenrecord', '--time-limit', '180', '/data/local/tmp/ruimte-rec.mp4']]);
        expect((await backend.detail('Pixel_9_Pro_API_35')).recording).toBe(true);
        await expect(backend.startRecording('Pixel_9_Pro_API_35', '/captures/again.mp4')).rejects.toMatchObject({ code: 'device-recording' });

        expect(await backend.stopRecording('Pixel_9_Pro_API_35')).toBe('/captures/Pixel-1.mp4');
        const tail = adb.calls.slice(-3).map((call) => call.join(' '));
        expect(tail).toEqual([
            interrupt,
            '-s emulator-5554 pull /data/local/tmp/ruimte-rec.mp4 /captures/Pixel-1.mp4',
            '-s emulator-5554 shell rm -f /data/local/tmp/ruimte-rec.mp4'
        ]);
        expect(recorder.signals).toEqual([]);
    });

    test("pulls a recording that reached Android's own limit without interrupting anything", async () => {
        const adb = new FakeAdb();
        const recorder = new FakeRecorder();
        const backend = backendWith(adb, { recordings: recorder.recordings() });
        await backend.startRecording('Pixel_9_Pro_API_35', '/captures/Pixel-1.mp4');

        recorder.finish(0);
        await Promise.resolve();

        // The next recording would write over the same file on the device, so it waits for this one to be pulled.
        expect(await backend.detail('Pixel_9_Pro_API_35')).toMatchObject({ recording: true, recordingEnded: true });
        await expect(backend.startRecording('Pixel_9_Pro_API_35', '/captures/Pixel-2.mp4')).rejects.toMatchObject({ code: 'device-recording' });
        expect(await backend.stopRecording('Pixel_9_Pro_API_35')).toBe('/captures/Pixel-1.mp4');
        expect(adb.calls.some((call) => call.includes('pkill -INT screenrecord'))).toBe(false);
    });

    test('erases a running emulator by stopping it and starting it again from a wiped data partition', async () => {
        const adb = new FakeAdb();
        const order: string[] = [];
        const answer = adb.run;
        const backend = backendWith(adb, {
            run: async (command, arguments_) => {
                if (arguments_.join(' ') === '-s emulator-5554 emu kill') {
                    order.push('kill');
                    adb.devices = 'List of devices attached\n';
                }
                return answer(command, arguments_);
            },
            launch: (_emulator, arguments_) => {
                order.push(arguments_.join(' '));
                return { exited: new Promise<number>(() => undefined), output: () => '' };
            }
        });
        await backend.list();

        expect(
            await backend.action('Pixel_9_Pro_API_35', { backendId: 'android', platform: 'android', deviceId: 'Pixel_9_Pro_API_35', action: 'erase' })
        ).toEqual({});
        expect(order).toEqual(['kill', '-avd Pixel_9_Pro_API_35 -port 5554 -no-window -no-boot-anim -wipe-data']);
    });

    test('never erases a phone and announces erase only on an emulator', async () => {
        const adb = new FakeAdb();
        adb.devices += 'R5CT device usb:1-1 model:SM_S921B transport_id:3\n';
        const backend = backendWith(adb);
        const devices = await backend.list();

        expect(devices.find((device) => device.deviceId === 'R5CT')!.capabilities.tools).not.toContain('erase');
        expect(devices.find((device) => device.deviceId === 'Pixel_9_Pro_API_35')!.capabilities.tools).toContain('erase');
        await expect(backend.action('R5CT', { backendId: 'android', platform: 'android', deviceId: 'R5CT', action: 'erase' })).rejects.toMatchObject({
            code: 'device-action-unavailable'
        });
    });

    test('runs the status bar, battery, fingerprint and permission tools as their exact adb commands', async () => {
        const adb = new FakeAdb();
        adb.devices += 'R5CT device usb:1-1 model:SM_S921B transport_id:3\n';
        const backend = backendWith(adb);
        await backend.list();
        const act = async (deviceId: string, action: Record<string, unknown>) => {
            adb.calls.length = 0;
            await backend.action(deviceId, { backendId: 'android', platform: 'android', deviceId, ...action } as DeviceAction);
            return adb.calls
                .map((call) => call.join(' '))
                .filter((call) => !call.includes('settings get') && !call.includes('devices -l') && !call.includes('emu avd name'));
        };

        expect(await act('Pixel_9_Pro_API_35', { action: 'setStatusBar', value: 'clean' })).toEqual([
            '-s emulator-5554 shell settings put global sysui_demo_allowed 1; am broadcast -a com.android.systemui.demo -e command enter; am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941; am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false; am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4; am broadcast -a com.android.systemui.demo -e command notifications -e visible false'
        ]);
        expect(await act('Pixel_9_Pro_API_35', { action: 'setStatusBar', value: 'default' })).toEqual([
            '-s emulator-5554 shell am broadcast -a com.android.systemui.demo -e command exit'
        ]);
        expect(await act('Pixel_9_Pro_API_35', { action: 'setBattery', level: 15, charging: false })).toEqual([
            '-s emulator-5554 emu power capacity 15',
            '-s emulator-5554 emu power ac off'
        ]);
        expect(await act('Pixel_9_Pro_API_35', { action: 'resetBattery' })).toEqual([
            '-s emulator-5554 emu power capacity 100',
            '-s emulator-5554 emu power ac on'
        ]);
        expect(await act('R5CT', { action: 'setBattery', level: 15, charging: true })).toEqual([
            '-s R5CT shell dumpsys battery set level 15; dumpsys battery set ac 1'
        ]);
        expect(await act('R5CT', { action: 'resetBattery' })).toEqual(['-s R5CT shell dumpsys battery reset']);
        expect(await act('Pixel_9_Pro_API_35', { action: 'biometric', sensor: 'finger', event: 'match' })).toEqual(['-s emulator-5554 emu finger touch 1']);
        expect(await act('Pixel_9_Pro_API_35', { action: 'biometric', sensor: 'finger', event: 'nomatch' })).toEqual(['-s emulator-5554 emu finger touch 99']);
        await expect(act('R5CT', { action: 'biometric', sensor: 'finger', event: 'match' })).rejects.toMatchObject({ code: 'device-action-unavailable' });
        await expect(act('Pixel_9_Pro_API_35', { action: 'biometric', sensor: 'finger', event: 'enroll' })).rejects.toMatchObject({
            code: 'device-action-unavailable'
        });
        await expect(act('Pixel_9_Pro_API_35', { action: 'shake' })).rejects.toMatchObject({ code: 'device-action-unavailable' });
        const all = await act('Pixel_9_Pro_API_35', { action: 'setAllPermissions', appId: 'com.example.app', decision: 'grant' });
        expect(all).toContain('-s emulator-5554 shell pm grant com.example.app android.permission.CAMERA');
        expect(all).toContain('-s emulator-5554 shell pm grant com.example.app android.permission.ACTIVITY_RECOGNITION');
        expect((await backend.detail('Pixel_9_Pro_API_35')).statusBar).toBe('default');
    });

    test('installs an .apk and pushes pictures and videos where the gallery looks, then asks for a scan', async () => {
        const adb = new FakeAdb();
        const backend = backendWith(adb);
        await backend.list();
        const act = async (action: Record<string, unknown>) => {
            adb.calls.length = 0;
            await backend.action('Pixel_9_Pro_API_35', {
                backendId: 'android',
                platform: 'android',
                deviceId: 'Pixel_9_Pro_API_35',
                ...action
            } as DeviceAction);
            return adb.calls
                .map((call) => call.join(' '))
                .filter((call) => !call.includes('settings get') && !call.includes('devices -l') && !call.includes('emu avd name'));
        };

        expect(await act({ action: 'installApp', path: '/work/atlas/app-debug.apk' })).toEqual(['-s emulator-5554 install -r /work/atlas/app-debug.apk']);
        expect(await act({ action: 'addMedia', paths: ['/work/atlas/my shot.png', '/work/atlas/clip.mp4'] })).toEqual([
            '-s emulator-5554 push /work/atlas/my shot.png /sdcard/Pictures/my shot.png',
            "-s emulator-5554 shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/my%20shot.png >/dev/null; content call --uri content://media/external/file --method scan_file --arg '/sdcard/Pictures/my shot.png' >/dev/null 2>&1; true",
            '-s emulator-5554 push /work/atlas/clip.mp4 /sdcard/Movies/clip.mp4',
            '-s emulator-5554 shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Movies/clip.mp4 >/dev/null; content call --uri content://media/external/file --method scan_file --arg /sdcard/Movies/clip.mp4 >/dev/null 2>&1; true'
        ]);
        await expect(act({ action: 'installApp', path: '/work/atlas/Atlas.app' })).rejects.toMatchObject({ code: 'device-path-refused' });
    });

    test('says why adb refused an install', async () => {
        const adb = new FakeAdb();
        const answer = adb.run;
        const backend = backendWith(adb, {
            run: async (command, arguments_) =>
                arguments_.includes('install')
                    ? { exitCode: 0, stdout: 'Performing Streamed Install\nFailure [INSTALL_FAILED_OLDER_SDK]\n', stderr: '' }
                    : answer(command, arguments_)
        });
        await backend.list();

        await expect(
            backend.action('Pixel_9_Pro_API_35', {
                backendId: 'android',
                platform: 'android',
                deviceId: 'Pixel_9_Pro_API_35',
                action: 'installApp',
                path: '/work/a.apk'
            })
        ).rejects.toThrow('Failure [INSTALL_FAILED_OLDER_SDK]');
    });

    test('folds and unfolds an emulator with a hinge through its console, asks for a fresh picture, and reads the hinge back', async () => {
        const adb = new FakeAdb();
        adb.shell.set('cmd device_state state', "Committed state: DeviceState{identifier=0, name='CLOSED', app_accessible=true}\n");
        const keyFrames: string[] = [];
        const backend = backendWith(adb, { readAvds: async () => [{ ...PIXEL, foldable: true }, TABLET] });
        const devices = await backend.list();
        const pixel = devices.find((device) => device.deviceId === 'Pixel_9_Pro_API_35');
        const tablet = devices.find((device) => device.deviceId === 'Tablet_API_34');
        expect(pixel!.capabilities.tools).toEqual(expect.arrayContaining(['fold', 'biometrics']));
        expect(tablet!.capabilities.tools).not.toContain('fold');
        const session = { requestKeyFrame: () => keyFrames.push('reset') } as unknown as DeviceSource;
        const fold = (value: string) =>
            backend.action(
                'Pixel_9_Pro_API_35',
                { backendId: 'android', platform: 'android', deviceId: 'Pixel_9_Pro_API_35', action: 'setFold', value } as DeviceAction,
                session
            );

        expect(await fold('closed')).toMatchObject({ hinge: 0 });
        await fold('tabletop');

        expect(adb.calls.map((call) => call.join(' ')).filter((call) => call.includes(' emu ') && call.includes('fold'))).toEqual([
            '-s emulator-5554 emu fold',
            '-s emulator-5554 emu unfold'
        ]);
        expect(keyFrames).toEqual(['reset', 'reset']);
        await expect(
            backend.action(
                'Pixel_9_Pro_API_35',
                { backendId: 'android', platform: 'android', deviceId: 'Pixel_9_Pro_API_35', action: 'setHinge', degrees: 90 },
                null
            )
        ).rejects.toMatchObject({ code: 'device-action-unavailable' });
    });

    test('reads the hinge of the committed device state', () => {
        expect(hingeOf("Committed state: DeviceState{identifier=2, name='OPENED', app_accessible=true}")).toEqual({ hinge: 180 });
        expect(hingeOf("Committed state: DeviceState{identifier=1, name='HALF_OPENED', app_accessible=true}")).toEqual({ hinge: 90 });
        expect(hingeOf("Committed state: DeviceState{identifier=0, name='FOLDED'}")).toEqual({ hinge: 0 });
        expect(hingeOf('No device states')).toEqual({});
    });

    test('reads a hinge sensor from the configuration of an AVD', async () => {
        const avdHome = await mkdtemp(join(tmpdir(), 'ruimte-avds-'));
        try {
            await mkdir(join(avdHome, 'Fold.avd'));
            await writeFile(join(avdHome, 'Fold.ini'), `path=${join(avdHome, 'Fold.avd')}\n`);
            await writeFile(
                join(avdHome, 'Fold.avd', 'config.ini'),
                'avd.ini.displayname=Pixel Fold\nhw.sensor.hinge = yes\nimage.sysdir.1=system-images/android-35/google_apis/arm64-v8a/\n'
            );
            expect(await readAvdFolder(avdHome)).toEqual([{ name: 'Fold', displayName: 'Pixel Fold', apiLevel: '35', foldable: true }]);
        } finally {
            await rm(avdHome, { recursive: true, force: true });
        }
    });
});
