import { greetingLines } from './cli/greeting.ts';
import type { ServerConfig } from './config.ts';
import { guardWeriftTurn } from './pulsar/turn-guard.ts';
import { armShutdownDeadline } from './shutdown-deadline.ts';
import { noteMoment, noteShutdown, reportFatal, type Launcher } from './telemetry/reporter.ts';
import { COMPILED as compiled, VERSION } from './version.ts';
import { wireDaemon } from './wire-daemon.ts';
import { listenFirst } from './wiring/http.ts';
import { productionSeams } from './wiring/production-seams.ts';
import { loopbackUrls, type DaemonRuntime } from './wiring/runtime.ts';

/*
 * Runs the daemon until a signal ends the process. The port is taken first, so every URL a session
 * is told is known before anything is wired (`wireDaemon`, `wire-daemon.ts`).
 */
export async function startDaemon(config: ServerConfig, launcher: Launcher = 'standalone'): Promise<void> {
    const doorway = listenFirst(config);
    const runtime: DaemonRuntime = { config, compiled, sourceDir: import.meta.dir, ...loopbackUrls(doorway.port) };
    // A TURN server that restarts under an allocation must not take the daemon with it; any other crash is reported on the way out.
    guardWeriftTurn(process, console, (code, error) => void reportFatal(error).finally(() => process.exit(code)));

    const wired = await wireDaemon({ runtime, launcher, seams: productionSeams(runtime), shutdown: (reason) => shutdown(reason) });
    const { agents, network } = wired.bundles;

    let shuttingDown = false;
    async function shutdown(reason: string): Promise<void> {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        armShutdownDeadline(
            (code) => process.exit(code),
            () => agents.sessions.killAllSettled()
        );
        noteShutdown();
        console.log(`ruimte server stopping for ${reason}, writing snapshots`);
        await wired.stop();
        void doorway.server.stop(true);
        process.exit(0);
    }

    await wired.start({ port: doorway.port, requestStop: () => void shutdown('a request'), serve: (input) => doorway.answer(input) });
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    const greeting = greetingLines({
        version: VERSION,
        host: doorway.hostname,
        port: doorway.port,
        home: config.home,
        interactive: process.stdout.isTTY === true && !config.underService
    });
    for (const line of greeting) {
        console.log(line);
    }
    noteMoment('daemon.boot', 'serving');
    // After the greeting, so a person who just ran `npx ruimte` reads what runs before where it is reachable.
    if (network.lanDoorWanted()) {
        network.lanDoor.start();
    }
}
