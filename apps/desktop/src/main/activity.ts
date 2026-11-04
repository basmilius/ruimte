import type { AppIpc } from '@adecore/shell';
import type { AgentActivity } from '@ruimte/desktop-bridge';
import { totalActivity } from '../app-windows';
import { electron } from './electron';

const { app } = electron;

export interface AgentActivities {
    /* What every window reports together, which the quit question names. */
    total(): AgentActivity;
    /* Lets the report of a window go, as one that closes or reloads does. */
    drop(windowId: number): void;
}

/* What the agents in each window are doing, for the dock badge and the quit question. */
export function installAgentActivity(ipc: AppIpc): AgentActivities {
    // By window id. The shell counts nothing itself, so the badge and the quit dialog agree with the toolbar.
    const activities = new Map<number, AgentActivity>();
    let total: AgentActivity = { working: 0, attention: 0 };

    const set = (windowId: number, activity: AgentActivity | null): void => {
        if (activity === null) {
            activities.delete(windowId);
        } else {
            activities.set(windowId, activity);
        }
        total = totalActivity(activities.values());
        // A dock badge is macOS and Linux; Windows has none and Electron's call does nothing there.
        if (process.platform !== 'win32') {
            app.setBadgeCount(total.attention);
        }
    };

    ipc.on('agents:activity', (event, activity: AgentActivity) => {
        const window = ipc.senderWindow(event);
        if (window) {
            set(window.id, typeof activity === 'object' && activity !== null ? activity : null);
        }
    });

    return {
        total: () => total,
        drop: (windowId) => set(windowId, null)
    };
}
