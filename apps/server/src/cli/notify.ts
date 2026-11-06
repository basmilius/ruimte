import { MACHINE_NOTIFY_MAX_TEXT, MACHINE_NOTIFY_PATH, MachineNotifyRefusalSchema } from '@ruimte/contracts';
import { askLocalDaemon, commandIo, homeSecret, otherHome, startFirst, tooOld, type LocalDaemonOptions } from './local-daemon.ts';

export interface NotifyOptions extends Omit<LocalDaemonOptions, 'out'> {
    // `--node`; absent, the terminal of Ruimte the script runs in.
    node?: string;
    text: string;
    env?: Record<string, string | undefined>;
}

/*
 * `ruimte notify`: a script on this machine raises a notification the way an agent's `alert` does,
 * on the phones and in every window, and it opens the node it names. Only the local secret may.
 */
export async function runNotify(options: NotifyOptions): Promise<number> {
    const { err } = commandIo(options);
    const nodeId = options.node ?? (options.env ?? process.env).RUIMTE_SESSION_ID ?? '';
    const text = options.text.trim();
    if (nodeId === '') {
        err('Name the node the notification opens with --node <id>, or run it in a terminal of Ruimte.');
        return 1;
    }
    if (text === '' || text.length > MACHINE_NOTIFY_MAX_TEXT) {
        err(`Usage: ruimte notify [--node <id>] <text>, with a text of at most ${MACHINE_NOTIFY_MAX_TEXT} characters.`);
        return 1;
    }
    const secret = await homeSecret(options);
    if (secret === null) {
        err(`No local secret in ${options.home}: only a process of the person whose daemon has that home may notify. ${startFirst(options.port)}`);
        return 1;
    }
    const response = await askLocalDaemon(options, secret, MACHINE_NOTIFY_PATH, { method: 'POST', body: { nodeId, text } });
    if (!response) {
        err(`No daemon answers on port ${options.port}. ${startFirst(options.port)}`);
        return 1;
    }
    if (response.status === 404) {
        err(tooOld(options.port, 'notify'));
        return 1;
    }
    if (response.status === 401 || response.status === 403) {
        err(otherHome(options));
        return 1;
    }
    if (!response.ok) {
        const refusal = MachineNotifyRefusalSchema.safeParse(await response.json().catch(() => null));
        err(
            refusal.success && refusal.data.code === 'node-not-found'
                ? `No project here holds the node ${nodeId}.`
                : `The daemon refused the notification (${response.status}).`
        );
        return 1;
    }
    return 0;
}
