import i18next from 'i18next';
import type { ProviderAccounts, ProviderInfo } from '@ruimte/contracts';
import { accountsOfKind, type AccountEntry } from '@adecore/agents-react/agents/accounts';
import type { ComputerSetupPhase } from '@/computer/setup';

export type OnboardingTask = 'intro' | 'providers' | 'computer';

/* A task, or the end of the walk, which says what is done. */
export type OnboardingPlace = OnboardingTask | 'done';

const ORDER: readonly OnboardingTask[] = ['intro', 'providers', 'computer'];

/* An installed agent CLI as the providers task lists it. */
export interface CliRow {
    provider: ProviderInfo;
    /* Whether the CLI has a login of its own, which is also the only way Ruimte can tell who is logged in. */
    canLogIn: boolean;
    /* The first account of it that is logged in. */
    loggedIn: AccountEntry | null;
    /* The account a Log in starts: the default one, unless that one is turned off. */
    loginAccount: AccountEntry | null;
}

/* What the tasks are measured against, read off the local machine and this client. */
export interface OnboardingFacts {
    introSeen: boolean;
    /* The CLIs with an account logged in, by name, in the order the machine lists them. */
    loggedIn: readonly string[];
    /* The CLIs that could log in and have nobody logged in yet. */
    notLoggedIn: readonly string[];
    computer: ComputerSetupPhase;
}

/* Apple's on-device model is a provider with no CLI to install or log in to. */
function isCli(provider: ProviderInfo): boolean {
    return provider.kind !== 'apple';
}

export function cliRowsOf(providers: readonly ProviderInfo[], accounts: ProviderAccounts | null): CliRow[] {
    return providers
        .filter((provider) => provider.installed && isCli(provider))
        .map((provider) => {
            const entries = accountsOfKind(accounts, provider.kind);
            const canLogIn = accounts?.loginCommands?.[provider.kind] !== undefined;
            return {
                provider,
                canLogIn,
                loggedIn: canLogIn ? (entries.find((entry) => entry.status?.state === 'ready') ?? null) : null,
                loginAccount: entries.find((entry) => entry.account.enabled !== false) ?? null
            };
        });
}

/* The CLIs the machine knows of and did not find, which the providers task names in one row. */
export function missingClisOf(providers: readonly ProviderInfo[]): string[] {
    return providers.filter((provider) => !provider.installed && isCli(provider)).map((provider) => provider.name);
}

export function factsOf(introSeen: boolean, rows: readonly CliRow[], computer: ComputerSetupPhase): OnboardingFacts {
    return {
        introSeen,
        loggedIn: rows.filter((row) => row.loggedIn !== null).map((row) => row.provider.name),
        notLoggedIn: rows.filter((row) => row.canLogIn && row.loggedIn === null).map((row) => row.provider.name),
        computer
    };
}

/* Computer use only where it can be: a Mac with the helper app, which a Linux machine or a daemon from npm lacks. */
export function tasksOf(computer: ComputerSetupPhase): OnboardingTask[] {
    return ORDER.filter((task) => task !== 'computer' || (computer !== 'unsupported' && computer !== 'unavailable'));
}

export function isDone(task: OnboardingTask, facts: OnboardingFacts): boolean {
    switch (task) {
        case 'intro':
            return facts.introSeen;
        case 'providers':
            return facts.loggedIn.length > 0;
        case 'computer':
            return facts.computer === 'ready';
    }
}

export function doneCount(tasks: readonly OnboardingTask[], facts: OnboardingFacts): number {
    return tasks.filter((task) => isDone(task, facts)).length;
}

/* Where the hub opens: the first task not done yet, or the end once every one is. */
export function firstPlace(tasks: readonly OnboardingTask[], facts: OnboardingFacts): OnboardingPlace {
    return tasks.find((task) => !isDone(task, facts)) ?? 'done';
}

/* Where leaving a task leads: the next one not done yet, then the earlier ones, and the end once no other is left. */
export function placeAfter(tasks: readonly OnboardingTask[], current: OnboardingTask, facts: OnboardingFacts): OnboardingPlace {
    const index = tasks.indexOf(current);
    const others = [...tasks.slice(index + 1), ...tasks.slice(0, Math.max(0, index))];
    return others.find((task) => !isDone(task, facts)) ?? 'done';
}

function t(key: string, values?: Record<string, unknown>): string {
    return i18next.t(`onboarding:${key}`, values ?? {});
}

/* Names as a sentence lists them: `Gemini CLI and Copilot`, `A, B and C`. */
export function joinNames(names: readonly string[]): string {
    return names.length <= 1 ? (names[0] ?? '') : t('list', { rest: names.slice(0, -1).join(', '), last: names[names.length - 1] });
}

/* The line under a task in the list, which says how far it is. */
export function taskLine(task: OnboardingTask, facts: OnboardingFacts): string {
    if (!isDone(task, facts)) {
        return t(`tasks.${task}.sub`);
    }
    return task === 'providers' ? t('tasks.providers.done', { clis: joinNames(facts.loggedIn) }) : t(`tasks.${task}.done`);
}

/* What the end of the walk says: what is done, then what is left and where it waits. */
export function summaryOf(tasks: readonly OnboardingTask[], facts: OnboardingFacts): string {
    const offersComputer = tasks.includes('computer');
    const computerOn = offersComputer && facts.computer === 'ready';
    const loggedIn = { clis: joinNames(facts.loggedIn), count: facts.loggedIn.length };
    const sentences: string[] = [];
    if (facts.loggedIn.length > 0) {
        sentences.push(t(computerOn ? 'done.summary.loggedInAndComputer' : 'done.summary.loggedIn', loggedIn));
    } else if (computerOn) {
        sentences.push(t('done.summary.computer'));
    }
    if (facts.notLoggedIn.length > 0) {
        sentences.push(t('done.summary.logInLater', { clis: joinNames(facts.notLoggedIn) }));
    } else if (facts.loggedIn.length === 0) {
        sentences.push(t('done.summary.noProvider'));
    }
    if (offersComputer && !computerOn) {
        sentences.push(t('done.summary.computerLater'));
    }
    return sentences.join(' ');
}
