import { userInfo } from 'node:os';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { errorText } from '../error-text.ts';
import { ClosedLid } from '../power/closed-lid.ts';
import { macClosedLidSystem } from '../power/closed-lid-system.ts';
import { caffeinateCommand, KeepAwake, agentsWorking, type KeepAwakeBlock, type HeldProcess } from '../power/keep-awake.ts';
import { MachineUpdates } from '../power/machine-update.ts';
import { ExecutionStateHold, windowsPower } from '../power/windows-keep-awake.ts';
import type { AgentsBundle } from './agents.ts';

/* What keeps the machine awake while its agents work, and the update of the desktop app on it. */
export interface PowerBundle {
    keepAwake: KeepAwake;
    closedLid: ClosedLid;
    updates: MachineUpdates;
    /* Looks again whether the machine should be held awake, after anything that may have changed it. */
    checkAwake(): void;
}

/* A Mac holds through a process, Windows on the daemon's own thread. The system libraries load on the first block, and a failure there is the block's to report. */
function blockHolder(): (block: KeepAwakeBlock) => HeldProcess {
    if (process.platform !== 'win32') {
        return (block) => Bun.spawn(caffeinateCommand(block, process.pid), { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    }
    let hold: ExecutionStateHold | null = null;
    return (block) => (hold ??= new ExecutionStateHold(windowsPower())).hold(block);
}

export function wirePower(home: string, identity: EndpointIdentity, agents: AgentsBundle): PowerBundle {
    const { sessions, chats } = agents;
    // Held by the daemon, so the machine stays awake with no window open and for a daemon from npm.
    const keepAwake = new KeepAwake({
        platform: process.platform,
        setting: () => identity.keepAwake,
        work: () => ({ sessions: sessions.list(), chats: chats.list() }),
        hold: blockHolder(),
        log: (line) => console.log(line)
    });
    const uid = process.getuid?.() ?? -1;
    // Beside the block, for a closed lid; it never holds root, only a sudoers rule a person installed.
    const closedLid = new ClosedLid({
        platform: process.platform,
        uid,
        user: userInfo().username,
        setting: () => identity.keepAwake,
        working: () => agentsWorking({ sessions: sessions.list(), chats: chats.list() }),
        system: macClosedLidSystem(home, uid),
        // A rule that went takes the switch with it, so a new rule never turns sleep off on a choice made before it.
        ruleChanged: (present) => {
            if (!present && identity.keepAwake.lidClosed) {
                void identity
                    .setSwitches({ keepAwakeLidClosed: false })
                    .catch((e: unknown) => console.error('Turning the closed-lid switch off failed:', errorText(e)));
                return;
            }
            identity.announce();
        },
        log: (line) => console.log(line)
    });
    identity.attachClosedLid({ describe: () => ({ keepAwakeLidRule: closedLid.ruleInstalled }) });
    const checkAwake = (): void => {
        keepAwake.check();
        closedLid.check();
    };
    sessions.observe((event) => {
        if (event.event === 'session.status' || event.event === 'session.exit' || event.event === 'session.list-changed') {
            checkAwake();
        }
    });
    chats.observe((event) => {
        if (event.event === 'chat.event' && (event.payload.event.type === 'info' || event.payload.event.type === 'reset')) {
            checkAwake();
        }
    });
    return { keepAwake, closedLid, updates: new MachineUpdates(), checkAwake };
}
