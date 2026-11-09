import { describe, expect, test } from 'bun:test';
import type { FoldPanel } from './fold-panel.ts';
import type { DeviceHelperCall } from './helper-protocol.ts';
import { SimulatorFold, type PanelMonitorFactory } from './simulator-fold.ts';

function helperAnswering(answers: Partial<Record<DeviceHelperCall['method'], boolean>> = {}) {
    const calls: DeviceHelperCall[] = [];
    return {
        calls,
        call: async (call: DeviceHelperCall) => {
            calls.push(call);
            return answers[call.method] ?? (call.method === 'preferredScreenSize' ? undefined : true);
        }
    };
}

function reporting(): { factory: PanelMonitorFactory; report: (panel: FoldPanel) => void; stops: () => number } {
    let onPanel: (panel: FoldPanel) => void = () => undefined;
    let stops = 0;
    return {
        factory: (_udid, listener) => {
            onPanel = listener;
            return {
                start: () => undefined,
                stop: async () => {
                    stops += 1;
                }
            };
        },
        report: (panel) => onPanel(panel),
        stops: () => stops
    };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SimulatorFold', () => {
    test('poses from the angle it has and captures the panel the new angle shows', async () => {
        const fold = new SimulatorFold('duo-1', reporting().factory);
        const helper = helperAnswering();

        await fold.pose(helper, 'closed');
        await fold.pose(helper, 'book');

        expect(helper.calls).toEqual([
            { method: 'isFoldable' },
            { method: 'pose', name: 'closed', fromDegrees: 180 },
            { method: 'preferredScreenSize', width: 1398, height: 2034 },
            { method: 'isFoldable' },
            { method: 'pose', name: 'book', fromDegrees: 0 },
            { method: 'preferredScreenSize', width: 2007, height: 2853 }
        ]);
        expect(fold.settings()).toEqual({ hinge: 130, panel: 'inner' });
    });

    test("follows SpringBoard's panel over the angle, and switches the capture only when the panel changes", async () => {
        const monitor = reporting();
        const fold = new SimulatorFold('duo-1', monitor.factory);
        const helper = helperAnswering();
        fold.attach(helper);

        monitor.report('inner');
        await settle();
        await fold.setHinge(helper, 100);
        monitor.report('cover');
        await settle();

        expect(helper.calls.filter((call) => call.method === 'preferredScreenSize')).toEqual([
            { method: 'preferredScreenSize', width: 2007, height: 2853 },
            { method: 'preferredScreenSize', width: 1398, height: 2034 }
        ]);
        expect(fold.settings()).toEqual({ hinge: 100, panel: 'cover' });
        fold.detach();
        expect(monitor.stops()).toBe(1);
    });

    test('refuses a simulator without a hinge, and keeps the angle when a pose is refused', async () => {
        const fold = new SimulatorFold('duo-1', reporting().factory);

        await expect(fold.pose(helperAnswering({ isFoldable: false }), 'open')).rejects.toMatchObject({ code: 'device-action-unavailable' });
        await expect(fold.pose(helperAnswering({ pose: false }), 'tent')).rejects.toMatchObject({ code: 'device-helper-failed' });
        await expect(fold.setHinge(helperAnswering({ hinge: false }), 45)).rejects.toMatchObject({ code: 'device-helper-failed' });
        expect(fold.settings()).toEqual({});
    });

    test('sets the known panel on a new capture again', async () => {
        const fold = new SimulatorFold('duo-1', reporting().factory);
        await fold.pose(helperAnswering(), 'closed');
        const next = helperAnswering();

        fold.attach(next);
        await settle();

        expect(next.calls).toEqual([{ method: 'preferredScreenSize', width: 1398, height: 2034 }]);
    });
});
