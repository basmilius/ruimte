import type { MachineStatus } from '@ruimte/contracts';
import { ClosedLidError, closedLidRule, closedLidRulePath, installRuleScript, removeRuleScript, SUDO } from '../power/closed-lid.ts';
import { lidLine } from './machine-status.ts';

export interface ClosedLidCliOptions {
    action: string;
    platform: NodeJS.Platform;
    uid: number;
    user: string;
    rulePresent(): Promise<boolean>;
    /* Runs a command on this terminal, so sudo asks for the password here; answers its exit code. */
    runAttached(command: string[]): Promise<number>;
    /* Asks the daemon running with this home how it stands, which has it read the rule again; null when none answers. */
    status(): Promise<MachineStatus | null>;
    out(line: string): void;
    err(line: string): void;
}

export const CLOSED_LID_USAGE = 'Usage: ruimte closed-lid install|remove';

const asRoot = (script: string): string[] => [SUDO, '/bin/sh', '-c', script];

/* What the running daemon makes of the rule now, or where to turn the switch on once one runs. */
const reportDaemon = async (options: ClosedLidCliOptions): Promise<void> => {
    const keepAwake = (await options.status())?.keepAwake;
    const lid = keepAwake ? lidLine(keepAwake) : null;
    if (lid === null) {
        options.out('Turn it on under keep awake, in Ruimte on your phone or under Settings, Agents in the app on this Mac.');
        return;
    }
    options.out(`Ruimte on this Mac: ${lid}.`);
};

/*
 * `ruimte closed-lid install|remove`: the sudoers rule behind keep awake with the lid closed, for a Mac
 * without the app. It prints exactly what it installs, and sudo asks for the password on this terminal.
 */
export const runClosedLid = async (options: ClosedLidCliOptions): Promise<number> => {
    const { out, err } = options;
    if (options.platform !== 'darwin') {
        err('Only a Mac can stay awake with its lid closed.');
        return 1;
    }
    const path = closedLidRulePath(options.uid);
    switch (options.action) {
        case 'install': {
            let rule: string;
            try {
                rule = closedLidRule(options.user);
            } catch (e) {
                err(e instanceof ClosedLidError ? e.message : String(e));
                return 1;
            }
            out(`This installs ${path}, owned by root and readable by root alone:`);
            out('');
            rule.trimEnd()
                .split('\n')
                .forEach((line) => out(`    ${line}`));
            out('');
            out(`It lets ${options.user} run exactly those two commands as root without a password, and nothing else.`);
            out('Ruimte runs them to turn sleep off while keep awake holds with the lid closed, and on again when it lets go.');
            out('sudo asks for your password now.');
            if ((await options.runAttached(asRoot(installRuleScript(options.user, options.uid)))) !== 0) {
                err('Nothing was installed.');
                return 1;
            }
            out(`Installed ${path}.`);
            await reportDaemon(options);
            return 0;
        }
        case 'remove': {
            if (!(await options.rulePresent())) {
                out(`${path} is not installed; there is nothing to remove.`);
                return 0;
            }
            out(`This turns sleep back on (pmset -a disablesleep 0) and removes ${path}. sudo asks for your password now.`);
            if ((await options.runAttached(asRoot(removeRuleScript(options.uid)))) !== 0) {
                err('Nothing was removed.');
                return 1;
            }
            out(`Removed ${path}. A closed lid sleeps this Mac again.`);
            // The daemon reads the rule again and turns its switch off with it.
            await options.status();
            return 0;
        }
        default:
            err(CLOSED_LID_USAGE);
            return 1;
    }
};
