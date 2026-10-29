import { chooseAccount, type AccountUnusable, type ChosenAccount, type ProviderAccountsService } from '@adecore/agents/providers';
import type { AgentKind, ProjectAccounts, ProjectSetAccountsPayload, UsageLimitsSnapshot } from '@ruimte/contracts';
import { ProjectError } from './project-error.ts';
import type { ProjectStore } from './project-store.ts';

type ProviderAccounts = ReturnType<ProviderAccountsService['snapshot']>;

interface ProjectAccountsDeps {
    /* The project a chat or session id sits in, or null for one outside every project. */
    projectOf(id: string): string | null;
    accountsOf(projectId: string): ProjectAccounts | undefined;
    providerAccounts: Pick<ProviderAccountsService, 'snapshot'>;
    limits(): UsageLimitsSnapshot | null;
    now(): number;
}

/*
 * The account a start in a project takes, or null where the project says nothing about this kind, which
 * leaves the start to the machine's order. A named account the project turned off refuses the start.
 */
export type ProjectAccountChooser = (id: string, kind: AgentKind, named: string | undefined) => ChosenAccount | null;

export function projectAccountChooser(deps: ProjectAccountsDeps): ProjectAccountChooser {
    return (id, kind, named) => {
        const projectId = deps.projectOf(id);
        const rule = projectId === null ? undefined : deps.accountsOf(projectId)?.[kind];

        if (rule === undefined) {
            return null;
        }

        const snapshot = deps.providerAccounts.snapshot();

        return chooseAccount({
            kind,
            accounts: snapshot.accounts,
            named,
            preferred: rule.default,
            off: rule.off ?? [],
            unusable: (account) => unusableReason(snapshot, deps.limits(), account, deps.now())
        });
    };
}

/*
 * Why an account cannot take a start now, from what the machine last heard; one never checked or read
 * counts as usable, and so does a spent window whose reset has passed, which a stale read still holds.
 */
export function unusableReason(snapshot: ProviderAccounts, limits: UsageLimitsSnapshot | null, id: string, now: number): AccountUnusable | null {
    if (snapshot.accounts[id]?.enabled === false) {
        return 'turned off on this machine';
    }

    const state = snapshot.statuses.find((status) => status.id === id)?.state;

    if (state === 'signed-out') {
        return 'signed out';
    }

    if (state === 'folder-missing' || state === 'unavailable' || state === 'not-found' || state === 'failed') {
        return 'not available on this machine';
    }

    const kind = snapshot.accounts[id]?.kind ?? id;
    const read = limits?.providers.find((entry) => entry.kind === kind && (entry.account?.id ?? entry.kind) === id);
    const spent = read?.windows.some((window) => window.used >= 1 && (window.resetsAt === null || window.resetsAt > now)) ?? false;

    return spent ? 'at its usage limit' : null;
}

/* What a chat says when its start passed over the project's default account. */
export function passedOverNote(took: string, passed: string, reason: AccountUnusable): string {
    return `Started on ${took}: ${passed} is ${reason}.`;
}

function sameChoice(a: { default?: string; off?: readonly string[] } | undefined, b: { default?: string; off?: readonly string[] } | undefined): boolean {
    const offOf = (choice: typeof a): string => [...new Set(choice?.off ?? [])].sort().join('\n');

    return a?.default === b?.default && offOf(a) === offOf(b);
}

/*
 * One person's accounts for one kind in a project; a default it also turns off is refused, and so is a
 * choice made on what another client changed since (`seen`), so one never silently undoes the other.
 */
export async function setProjectAccounts(store: Pick<ProjectStore, 'mutate'>, payload: ProjectSetAccountsPayload): Promise<ProjectAccounts> {
    const { projectId, kind, default: preferred, off, seen } = payload;

    if (preferred !== null && off.includes(preferred)) {
        throw new ProjectError('project-invalid', `The account '${preferred}' cannot be this project's default and be turned off in it`);
    }

    return store.mutate(projectId, (content) => {
        if (seen !== undefined && !sameChoice(content.accounts?.[kind], seen)) {
            throw new ProjectError('rev-conflict', 'The accounts of this project changed since they were read; read them again');
        }

        const { [kind]: _before, ...others } = content.accounts ?? {};
        const choice = { ...(preferred === null ? {} : { default: preferred }), ...(off.length === 0 ? {} : { off: [...new Set(off)] }) };
        const accounts = Object.keys(choice).length === 0 ? others : { ...others, [kind]: choice };
        const { accounts: _previous, ...rest } = content;

        return { content: Object.keys(accounts).length === 0 ? rest : { ...rest, accounts }, result: accounts };
    });
}
