import type { DeviceFoldPose, DeviceSettings } from '@ruimte/contracts';
import { bestEffort } from '../best-effort.ts';
import { DeviceError } from './device-error.ts';
import { FoldPanelMonitor, PANEL_SIZES, panelOfAngle, POSE_DEGREES, type FoldPanel } from './fold-panel.ts';
import type { DeviceHelperCall } from './helper-protocol.ts';

interface FoldHelper {
    call(call: DeviceHelperCall): Promise<boolean | undefined>;
}

export type PanelMonitorFactory = (udid: string, onPanel: (panel: FoldPanel) => void) => Pick<FoldPanelMonitor, 'start' | 'stop'>;

export const realPanelMonitor: PanelMonitorFactory = (udid, onPanel) => new FoldPanelMonitor({ udid, onPanel });

/*
 * The hinge of an iPhone Duo simulator and the panel its picture shows. The angle is what this daemon
 * last set, since the simulator does not say; the panel is SpringBoard's word, and the angle's until
 * SpringBoard has spoken after a change. The panel follows SpringBoard for as long as a session runs.
 */
export class SimulatorFold {
    private readonly udid: string;
    private readonly monitorOf: PanelMonitorFactory;
    private hinge: number | null = null;
    private panel: FoldPanel | null = null;
    private helper: FoldHelper | null = null;
    private monitor: Pick<FoldPanelMonitor, 'start' | 'stop'> | null = null;

    constructor(udid: string, monitorOf: PanelMonitorFactory = realPanelMonitor) {
        this.udid = udid;
        this.monitorOf = monitorOf;
    }

    /* A session began: the helper captures the panel SpringBoard says from now on. */
    attach(helper: FoldHelper): void {
        this.detach();
        this.helper = helper;
        // A new capture starts on the simulator's own choice of panel, so the known one is set on it again.
        const known = this.hinge === null ? null : panelOfAngle(this.hinge);
        this.panel = null;
        if (known !== null) {
            void bestEffort('show', this.show(known));
        }
        this.monitor = this.monitorOf(this.udid, (panel) => void bestEffort('show', this.show(panel)));
        this.monitor.start();
    }

    detach(): void {
        void this.monitor?.stop();
        this.monitor = null;
        this.helper = null;
    }

    async pose(helper: FoldHelper, pose: DeviceFoldPose): Promise<void> {
        await this.requireFoldable(helper);
        // The simulator moves from the angle it has to the pose, and an unknown angle reads off the panel it shows.
        const from = this.hinge ?? (this.panel === 'cover' ? POSE_DEGREES.closed : POSE_DEGREES.open);
        if ((await helper.call({ method: 'pose', name: pose, fromDegrees: from })) !== true) {
            throw new DeviceError('device-helper-failed', `The simulator did not take the ${pose} pose`);
        }
        await this.moved(helper, POSE_DEGREES[pose]);
    }

    async setHinge(helper: FoldHelper, degrees: number): Promise<void> {
        await this.requireFoldable(helper);
        if ((await helper.call({ method: 'hinge', degrees })) !== true) {
            throw new DeviceError('device-helper-failed', `The simulator did not take a hinge of ${degrees} degrees`);
        }
        await this.moved(helper, degrees);
    }

    settings(): Pick<DeviceSettings, 'hinge' | 'panel'> {
        return { ...(this.hinge === null ? {} : { hinge: this.hinge }), ...(this.panel === null ? {} : { panel: this.panel }) };
    }

    private async requireFoldable(helper: FoldHelper): Promise<void> {
        if ((await helper.call({ method: 'isFoldable' })) !== true) {
            throw new DeviceError(
                'device-action-unavailable',
                'This simulator has no hinge: an iPhone Duo folds only with Xcode 27.1 and the iOS 27.1 runtime'
            );
        }
    }

    /* The angle decides the panel at once; SpringBoard's report corrects it, since a middle pose shows the panel of the way it folded. */
    private async moved(helper: FoldHelper, degrees: number): Promise<void> {
        this.hinge = degrees;
        this.helper ??= helper;
        await this.show(panelOfAngle(degrees));
    }

    private async show(panel: FoldPanel): Promise<void> {
        if (panel === this.panel) {
            return;
        }
        this.panel = panel;
        await this.helper?.call({ method: 'preferredScreenSize', ...PANEL_SIZES[panel] });
    }
}
