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
            unusable: (account) => unusableReason(snapshot, deps.limits(), account)
        });
    };
}

/* Why an account cannot take a start now, from what the machine last heard; one never checked or read counts as usable. */
export function unusableReason(snapshot: ProviderAccounts, limits: UsageLimitsSnapshot | null, id: string): AccountUnusable | null {
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

    return read !== undefined && read.windows.some((window) => window.used >= 1) ? 'at its usage limit' : null;
}

/* What a chat says when its start passed over the project's default account. */
export function passedOverNote(took: string, passed: string, reason: AccountUnusable): string {
    return `Started on ${took}: ${passed} is ${reason}.`;
}

/* One person's accounts for one kind in a project; a default it also turns off is refused. */
export async function setProjectAccounts(store: Pick<ProjectStore, 'mutate'>, payload: ProjectSetAccountsPayload): Promise<ProjectAccounts> {
    const { projectId, kind, default: preferred, off } = payload;

    if (preferred !== null && off.includes(preferred)) {
        throw new ProjectError('project-invalid', `The account '${preferred}' cannot be this project's default and be turned off in it`);
    }

    return store.mutate(projectId, (content) => {
        const { [kind]: _before, ...others } = content.accounts ?? {};
        const choice = { ...(preferred === null ? {} : { default: preferred }), ...(off.length === 0 ? {} : { off: [...new Set(off)] }) };
        const accounts = Object.keys(choice).length === 0 ? others : { ...others, [kind]: choice };
        const { accounts: _previous, ...rest } = content;

        return { content: Object.keys(accounts).length === 0 ? rest : { ...rest, accounts }, result: accounts };
    });
}
