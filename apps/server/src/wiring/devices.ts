import { resolve } from 'node:path';
import type { Area } from '../area.ts';
import { BrowserDriver } from '../browser/drive.ts';
import { BrowserManager } from '../browser/manager.ts';
import { BrowserPages } from '../browser/pages.ts';
import { ComputerUse } from '../computer/computer-use.ts';
import { ComputerHelper, locateHelperApp } from '../computer/helper.ts';
import type { ComputerUseStore } from '../computer/store.ts';
import { DeviceDriver } from '../devices/agent-driver.ts';
import { AndroidBackend } from '../devices/android.ts';
import { DeviceControl } from '../devices/control.ts';
import { DeviceWatch } from '../devices/device-watch.ts';
import { createDeviceHelperLauncher } from '../devices/helper-source.ts';
import { createPhysicalBatteryReader, IosPhysicalBackend } from '../devices/ios-physical.ts';
import { IosSimulatorBackend } from '../devices/ios-simulator.ts';
import { DeviceManager } from '../devices/manager.ts';
import { createPhysicalStreamSourceFactory, physicalStreamHelperPath } from '../devices/physical-stream-source.ts';
import { ScrcpyServerFile, scrcpyServerDirectory } from '../devices/scrcpy-server.ts';
import { adbScrcpyHost, ScrcpySource } from '../devices/scrcpy-source.ts';
import { realCameraHost, SimulatorCamera, simctlWithEnv } from '../devices/simulator-camera.ts';
import { createTreeLauncher, SimulatorTreeReader } from '../devices/simulator-tree.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import type { NodeLifecycle } from '../node-lifecycle.ts';
import { LiveStreamHub } from '../streams/live-stream.ts';
import { VisualRenderer } from '../visuals/renderer.ts';
import type { DaemonBundles } from './bundles.ts';
import type { Later } from './later.ts';
import type { DaemonRuntime } from './runtime.ts';
import type { DaemonSeams } from './seams.ts';

/* What lets agents operate this machine's apps; made before the providers, since its helper starts beside their files. */
export function createComputer(
    runtime: DaemonRuntime,
    store: ComputerUseStore,
    lifecycle: NodeLifecycle,
    later: Later<Pick<DaemonBundles, 'agents' | 'projects'>>
): ComputerUse {
    const { config } = runtime;
    const computer = new ComputerUse({
        home: config.home,
        store,
        helper: new ComputerHelper({
            home: config.home,
            appPath: locateHelperApp({ platform: process.platform, compiled: runtime.compiled, execPath: process.execPath, sourceDir: runtime.sourceDir })
        }),
        // A grant for this time ends with the shell or the CLI conversation it was given to.
        runOf: (id) => {
            const session = later.agents().sessions.get(id);
            if (session && !session.exited) {
                return `terminal:${session.hookToken}`;
            }
            const chat = later.agents().chats.get(id);
            return chat ? `chat:${chat.info.agentSessionId ?? id}` : null;
        },
        describe: async (id) => {
            const projects = later.projects().store;
            const place = projects.index.locate(id);
            const project = place === null ? undefined : (await projects.known()).find((known) => known.projectId === place.projectId);
            return {
                surface: later.agents().sessions.get(id) ? 'terminal' : 'chat',
                nodeTitle: projects.index.titleFor(id),
                projectId: place?.projectId ?? null,
                projectName: project?.name ?? null
            };
        }
    });
    computer.follow(lifecycle);
    return computer;
}

/* The pages, devices and apps an agent or a person can see and operate through this machine. */
export interface DevicesBundle {
    computer: ComputerUse;
    liveStreams: LiveStreamHub;
    browsers: BrowserManager;
    /* The pages the clients draw themselves, which this machine can only reach by asking them. */
    browserPages: BrowserPages;
    browserDriver: BrowserDriver;
    /* Visuals are rendered in children with a Chrome of their own, never in the browsers, whose profile holds a person's cookies. */
    visualRenderer: VisualRenderer;
    devices: DeviceManager;
    deviceControl: DeviceControl;
    deviceWatch: DeviceWatch;
    deviceDriver: DeviceDriver;
}

export function wireDevices(
    runtime: DaemonRuntime,
    computer: ComputerUse,
    lifecycle: NodeLifecycle,
    machineHome: MachineHome,
    seams: Pick<DaemonSeams, 'visualLauncher'>
): DevicesBundle {
    const { config, compiled, sourceDir } = runtime;
    const liveStreams = new LiveStreamHub();
    const browsers = BrowserManager.withBun(config.home, liveStreams);
    const browserPages = new BrowserPages();
    const browserDriver = new BrowserDriver(config.home, browsers, browserPages);
    const deviceHelperCommand = compiled ? [process.execPath, 'device-helper'] : [process.execPath, resolve(sourceDir, 'main.ts'), 'device-helper'];
    const visualRenderer = new VisualRenderer(seams.visualLauncher);
    const deviceBridge = physicalStreamHelperPath(compiled, process.execPath, resolve(sourceDir, '../..'));
    const physicalStreamSource = createPhysicalStreamSourceFactory(deviceBridge);
    const treeLauncher = createTreeLauncher(deviceBridge);
    // A development checkout fetches the pinned screen server on first use; a build carries it.
    const scrcpyServer = new ScrcpyServerFile(scrcpyServerDirectory(compiled, process.execPath, resolve(sourceDir, '..')), !compiled);
    const android = new AndroidBackend({
        createSource: scrcpyServer.available ? (adb, serial) => new ScrcpySource(adbScrcpyHost(adb, serial), () => scrcpyServer.path()) : null
    });
    const devices = new DeviceManager(
        process.platform === 'darwin'
            ? [
                  new IosSimulatorBackend(
                      undefined,
                      createDeviceHelperLauncher(deviceHelperCommand),
                      undefined,
                      treeLauncher === null ? null : (udid) => new SimulatorTreeReader(udid, treeLauncher),
                      undefined,
                      undefined,
                      new SimulatorCamera(config.home, realCameraHost, simctlWithEnv)
                  ),
                  new IosPhysicalBackend(undefined, undefined, physicalStreamSource, undefined, createPhysicalBatteryReader(deviceBridge)),
                  android
              ]
            : process.platform === 'linux'
              ? [android]
              : [],
        liveStreams,
        (path) => machineHome.refuse(path)
    );
    const deviceControl = new DeviceControl();
    const deviceWatch = new DeviceWatch(devices);
    const deviceDriver = new DeviceDriver({ home: config.home, manager: devices, gate: deviceControl });
    deviceDriver.follow(lifecycle);
    return { computer, liveStreams, browsers, browserPages, browserDriver, visualRenderer, devices, deviceControl, deviceWatch, deviceDriver };
}

/* What an agent claims of a device and the renderer of visuals belong to no request; they go between the browsers and the devices. */
export function devicesLifecycle({ visualRenderer, deviceDriver }: DevicesBundle): Area {
    return {
        name: 'device claims',
        stop: [
            { phase: 'end', label: 'Stopping visual previews', run: () => visualRenderer.stop() },
            { phase: 'end', label: 'Releasing devices', run: () => deviceDriver.releaseAll() }
        ]
    };
}
