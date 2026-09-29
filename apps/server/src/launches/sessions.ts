import type { SessionManager } from '../sessions/manager.ts';
import type { LaunchSessions } from './runner.ts';

// The size a launch starts at; the first client that shows it fits it to its own.
const COLS = 120;
const ROWS = 32;

/*
 * The launch sessions over the session manager. A signal goes to the terminal's foreground group
 * as well as to the shell, since an interactive shell ignores SIGTERM and puts its command in a
 * group of its own.
 */
export const managerSessions = (manager: SessionManager, foregroundGroup: (pid: number) => Promise<number | null>): LaunchSessions => ({
    create: async ({ sessionId, cwd, exec, env }) => {
        await manager.create({ sessionId, cwd, exec, env, fresh: true, cols: COLS, rows: ROWS });
    },
    interrupt: (sessionId) => {
        if (manager.get(sessionId)?.exited === false) {
            manager.write(sessionId, '\x03');
        }
    },
    signal: async (sessionId, signal) => {
        const session = manager.get(sessionId);
        if (!session || session.exited) {
            return;
        }
        const group = await foregroundGroup(session.pid);
        if (group !== null) {
            try {
                process.kill(-group, signal);
            } catch {
                // The group went between the question and the signal.
            }
        }
        if (group !== session.pid) {
            manager.signal(sessionId, signal);
        }
    },
    remove: async (sessionId) => {
        if (manager.get(sessionId)) {
            await manager.kill(sessionId);
        }
    },
    observeExit: (listener) => manager.observeExit(listener)
});
