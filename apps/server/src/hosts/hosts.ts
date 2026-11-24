import { CodedError } from '@adecore/agents';
import {
    parseHostRef,
    providedChange,
    providedChangePage,
    providedCheckLog,
    providedHostStatus,
    providedIssue,
    providedIssuePage,
    providedLocator,
    hostRef,
    type HostChange,
    type HostChangesPayload,
    type HostChangesResult,
    type HostIssuesPayload,
    type HostIssuesResult,
    type HostCheckLogResult,
    type HostIssue,
    type HostProviderMethod,
    type HostProviderShape,
    type HostProviderStatus,
    type HostRef,
    type ProvidedHostStatus
} from '@ruimte/contracts';
import { errorText } from '../error-text.ts';

/* A project as a provider is asked about it. */
export interface HostProject {
    id: string;
    name: string;
    folder: string;
}

/* A checkout a code host is found from: where it is, what the git panel calls it, its remotes and what is checked out. */
export interface HostCheckout {
    path: string;
    label: string;
    remotes: string[];
    branch: string | null;
}

/* A provider an extension defined, with the optional parts it has. */
export interface DefinedProvider extends HostProviderShape {
    extension: string;
    id: string;
}

/* What the hosts ask of the extensions: which providers there are, and one thing of one of them, in its extension's process. */
export interface HostProviderPort {
    list(): Promise<DefinedProvider[]>;
    ask(extension: string, provider: string, method: HostProviderMethod, args: readonly unknown[]): Promise<unknown>;
    /* Something a provider did wrong, for the log its author reads. */
    note(extension: string, line: string): void;
}

interface HostsOptions {
    providers: HostProviderPort;
    /* Null for a project this machine does not know or that has no folder. */
    projectOf(projectId: string): Promise<HostProject | null>;
    checkouts: {
        repos(folder: string): Promise<HostCheckout[]>;
        of(folder: string): Promise<HostCheckout | null>;
    };
    /* The folder a chat works in; null for a chat this machine does not have. */
    cwdOf(chatId: string): Promise<string | null>;
    /* The providers of a project are no longer what they were. */
    changed(projectId: string): void;
}

/* A provider that applies to a project: a code host by one remote of one of its checkouts, or a tracker that said so itself. */
interface Bound {
    defined: DefinedProvider;
    remote?: string;
    repo?: string;
    status: ProvidedHostStatus;
}

type Capability = 'issues' | 'changes' | 'checks';

const CAPABILITY_WORDS: Readonly<Record<Capability, string>> = { issues: 'issues', changes: 'changes', checks: 'check logs' };

function scopeOf(project: HostProject, bound: Pick<Bound, 'remote'>): { project: HostProject; remote?: string } {
    return bound.remote === undefined ? { project } : { project, remote: bound.remote };
}

function statusOf(bound: Bound): HostProviderStatus {
    const { defined, status } = bound;

    return {
        provider: defined.id,
        extension: defined.extension,
        title: defined.title,
        kind: defined.matches ? 'code-host' : 'tracker',
        ...(bound.remote === undefined ? {} : { remote: bound.remote }),
        ...(bound.repo === undefined ? {} : { repo: bound.repo }),
        issues: defined.issues,
        changes: defined.changes,
        checks: defined.checks,
        // `not-configured` never gets here: such a provider is no provider of the project.
        state: status.state === 'not-configured' ? 'unreachable' : status.state,
        ...(status.reason === undefined ? {} : { reason: status.reason }),
        ...(status.account === undefined ? {} : { account: status.account })
    };
}

/*
 * The code hosts and issue trackers of each project, and what is read through them. A provider is an extension's:
 * this only knows which of them a project has, asks them in their own process, and takes nothing they answer as it
 * came (`extension-hosts.ts` cuts and checks it). Which providers a project has is kept until an extension changes or
 * a client asks `host.status` again; nothing a host says about an issue or a change is kept at all.
 */
export class Hosts {
    private readonly options: HostsOptions;
    private readonly bound = new Map<string, Promise<Bound[]>>();

    constructor(options: HostsOptions) {
        this.options = options;
    }

    /* Asks every provider again whether it answers for the project, which is what a panel that opens wants to know. */
    async status(projectId: string): Promise<HostProviderStatus[]> {
        this.bound.delete(projectId);

        return (await this.boundTo(projectId)).map(statusOf);
    }

    /* Whether a project has a provider at all, signed in or not, from what was found last. */
    async has(projectId: string): Promise<boolean> {
        return (await this.boundTo(projectId)).length > 0;
    }

    /* What an extension supplies may differ from here on, so every project is looked at again when it is next asked about. */
    extensionChanged(): void {
        const projects = [...this.bound.keys()];

        this.bound.clear();

        for (const projectId of projects) {
            this.options.changed(projectId);
        }
    }

    async issues(payload: HostIssuesPayload): Promise<HostIssuesResult> {
        const { projectId, provider, remote, ...filter } = payload;
        const { project, bound } = await this.providerOf(projectId, provider, 'issues', remote);
        const page = providedIssuePage(provider, await this.ask(bound, 'issues.list', [scopeOf(project, bound), filter]), (reason) => this.note(bound, reason));

        return { issues: page.items, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) };
    }

    async issue(projectId: string, ref: HostRef): Promise<HostIssue> {
        const { provider, locator } = this.parsed(ref);
        const { project, bound } = await this.providerOf(projectId, provider, 'issues');
        const issue = this.read(bound, await this.ask(bound, 'issues.read', [scopeOf(project, bound), locator]), providedIssue);

        if (issue === null) {
            throw new CodedError('not-found', `${bound.defined.title} has no issue ${locator}`);
        }

        return issue;
    }

    async changes(payload: HostChangesPayload): Promise<HostChangesResult> {
        const { projectId, provider, remote, ...filter } = payload;
        const { project, bound } = await this.providerOf(projectId, provider, 'changes', remote);
        const page = providedChangePage(provider, await this.ask(bound, 'changes.list', [scopeOf(project, bound), filter]), (reason) =>
            this.note(bound, reason)
        );

        return { changes: page.items, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) };
    }

    async change(projectId: string, ref: HostRef): Promise<HostChange> {
        const { provider, locator } = this.parsed(ref);
        const { project, bound } = await this.providerOf(projectId, provider, 'changes');
        const change = this.read(bound, await this.ask(bound, 'changes.read', [scopeOf(project, bound), locator]), providedChange);

        if (change === null) {
            throw new CodedError('not-found', `${bound.defined.title} has no change ${locator}`);
        }

        return change;
    }

    /* The change of the branch a chat works on, against the host of the repository its folder is in; null when there is none. */
    async changeOfChat(projectId: string, chatId: string): Promise<HostChange | null> {
        const cwd = await this.options.cwdOf(chatId);

        return cwd === null ? null : this.changeOfFolder(projectId, cwd);
    }

    async changeOfFolder(projectId: string, folder: string): Promise<HostChange | null> {
        const checkout = await this.options.checkouts.of(folder);
        const project = await this.options.projectOf(projectId);

        if (checkout === null || checkout.branch === null || project === null) {
            return null;
        }

        // Only the host of this very repository: a branch of the same name elsewhere is another branch.
        const bound = (await this.boundTo(projectId)).find(
            (candidate) => candidate.defined.changes && candidate.remote !== undefined && checkout.remotes.includes(candidate.remote)
        );

        if (bound === undefined) {
            return null;
        }

        // A host that does not answer now, signed out or away, shows a chat no change rather than an error on every chat.
        const locator = providedLocator(await this.ask(bound, 'changes.forBranch', [scopeOf(project, bound), checkout.branch]).catch(() => null));

        return locator === null ? null : this.change(projectId, hostRef(bound.defined.id, locator));
    }

    async checkLog(projectId: string, ref: HostRef, check: string): Promise<HostCheckLogResult> {
        const { provider, locator } = this.parsed(ref);
        const { project, bound } = await this.providerOf(projectId, provider, 'checks');
        const log = this.read(bound, await this.ask(bound, 'checks.log', [scopeOf(project, bound), locator, check]), (_provider, answer) =>
            providedCheckLog(answer)
        );

        if (log === null) {
            throw new CodedError('not-found', `${bound.defined.title} has no log of the check ${check} on ${locator}`);
        }

        return log;
    }

    /*
     * The ref a person or an agent means by `text`: a ref of one of the project's providers as it stands, else the
     * link or short form a provider says is its own. Null for text none of them owns.
     */
    async resolve(projectId: string, text: string): Promise<HostRef | null> {
        const bounds = await this.boundTo(projectId);
        const named = parseHostRef(text);

        if (named !== null && bounds.some((bound) => bound.defined.id === named.provider)) {
            return text;
        }

        const project = await this.options.projectOf(projectId);

        for (const bound of bounds) {
            if (project === null || !bound.defined.parses) {
                continue;
            }

            const locator = providedLocator(await this.ask(bound, 'issues.parse', [scopeOf(project, bound), text]).catch(() => null));

            if (locator !== null) {
                return hostRef(bound.defined.id, locator);
            }
        }

        return null;
    }

    private parsed(ref: HostRef): { provider: string; locator: string } {
        const parsed = parseHostRef(ref);

        if (parsed === null) {
            throw new CodedError('bad-request', `${ref} is no ref; a ref is <provider>:<locator>`);
        }

        return parsed;
    }

    private boundTo(projectId: string): Promise<Bound[]> {
        let found = this.bound.get(projectId);

        if (found === undefined) {
            found = this.find(projectId).catch((e: unknown) => {
                console.warn(`Finding the hosts of ${projectId} failed: ${errorText(e)}`);
                // Not kept, so the next ask looks again.
                this.bound.delete(projectId);

                return [];
            });
            this.bound.set(projectId, found);
        }

        return found;
    }

    private async find(projectId: string): Promise<Bound[]> {
        const project = await this.options.projectOf(projectId);

        if (project === null) {
            return [];
        }

        const defined = this.firstOfEachId(await this.options.providers.list());
        const checkouts = defined.some((provider) => provider.matches) ? await this.options.checkouts.repos(project.folder) : [];
        const candidates: Omit<Bound, 'status'>[] = [];

        for (const provider of defined) {
            if (!provider.matches) {
                candidates.push({ defined: provider });

                continue;
            }

            for (const checkout of checkouts) {
                const remote = await this.matched(provider, checkout);

                if (remote !== null && !candidates.some((candidate) => candidate.defined === provider && candidate.remote === remote)) {
                    candidates.push({ defined: provider, remote, repo: checkout.label });
                }
            }
        }

        const bounds = await Promise.all(
            candidates.map(async (candidate): Promise<Bound> => ({ ...candidate, status: await this.statusOf(project, candidate) }))
        );

        return bounds.filter((bound) => bound.status.state !== 'not-configured');
    }

    /* A ref names its provider by id alone, so two extensions cannot both supply one: the first keeps it. */
    private firstOfEachId(defined: readonly DefinedProvider[]): DefinedProvider[] {
        const kept = new Map<string, DefinedProvider>();

        for (const provider of defined) {
            const first = kept.get(provider.id);

            if (first === undefined) {
                kept.set(provider.id, provider);
            } else {
                this.options.providers.note(provider.extension, `The host provider ${provider.id} is ${first.extension}'s already, so this one is left out`);
            }
        }

        return [...kept.values()];
    }

    private async matched(provider: DefinedProvider, checkout: HostCheckout): Promise<string | null> {
        for (const remote of checkout.remotes) {
            const matches = await this.options.providers.ask(provider.extension, provider.id, 'match', [remote]).catch(() => false);

            if (matches === true) {
                return remote;
            }
        }

        return null;
    }

    private async statusOf(project: HostProject, candidate: Omit<Bound, 'status'>): Promise<ProvidedHostStatus> {
        try {
            return providedHostStatus(
                await this.options.providers.ask(candidate.defined.extension, candidate.defined.id, 'status', [scopeOf(project, candidate)])
            );
        } catch (e) {
            // A tracker that fails says nothing about whether the project is its own, so it stays in sight with the reason.
            return { state: 'unreachable', reason: errorText(e).slice(0, 300) };
        }
    }

    private async providerOf(projectId: string, provider: string, capability: Capability, remote?: string): Promise<{ project: HostProject; bound: Bound }> {
        const project = await this.options.projectOf(projectId);
        const bound = (await this.boundTo(projectId)).find(
            (candidate) => candidate.defined.id === provider && (remote === undefined || candidate.remote === remote)
        );

        if (project === null || bound === undefined) {
            throw new CodedError('no-provider', `This project has no ${provider}`);
        }

        if (!bound.defined[capability]) {
            throw new CodedError('unsupported', `${bound.defined.title} has no ${CAPABILITY_WORDS[capability]}`);
        }

        return { project, bound };
    }

    private async ask(bound: Bound, method: HostProviderMethod, args: readonly unknown[]): Promise<unknown> {
        try {
            return await this.options.providers.ask(bound.defined.extension, bound.defined.id, method, args);
        } catch (e) {
            throw new CodedError('host-failed', `${bound.defined.title} did not answer: ${errorText(e)}`);
        }
    }

    /* Reads one answer, and says so in the extension's log when it is none, since its author is who can fix that. */
    private read<Value>(bound: Bound, answer: unknown, parse: (provider: string, answer: unknown) => Value | null): Value | null {
        try {
            return parse(bound.defined.id, answer);
        } catch (e) {
            this.note(bound, errorText(e));

            throw new CodedError('host-failed', `${bound.defined.title} gave an answer Ruimte cannot read`);
        }
    }

    private note(bound: Bound, reason: string): void {
        this.options.providers.note(bound.defined.extension, `${bound.defined.id} ${reason}`);
    }
}
