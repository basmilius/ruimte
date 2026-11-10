import type { ComposerStatusDetail, ComposerStatusItem } from '@adecore/agents-react';
import { useChatRow } from '@adecore/agents-react/state';
import type { GitStatus } from '@ruimte/contracts';
import type { TFunction } from 'i18next';
import { Folder, FolderGit2, GitBranch, Server } from 'lucide-react';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useGitCheckouts, useProjectRepos } from '@/controllers/git-repos';
import { useGitStatus } from '@/controllers/git-watch';
import { nameOf } from '@/machines/machine-list';
import { useMachineEntry } from '@/machines/use-machine-entry';
import { isThisMachine } from '@/state/local-machine';
import { ChatOnCanvasContext } from '@/surface/nodes/chat-on-canvas';

/* Another repository in the chat's folder, such as a submodule, by the name the git panel gives it. */
interface OtherRepo {
    label: string;
    status: GitStatus | null;
}

interface WhereInput {
    status: GitStatus | null;
    others: readonly OtherRepo[];
    /* The machine's name, set only when the chat runs on another machine than this one. */
    machine: string | null;
    onCanvas: boolean;
    t: TFunction<'chat'>;
}

function lastSegment(path: string): string {
    return (
        path
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .at(-1) ?? path
    );
}

/* `resolveBase` names the remote's default branch through `origin`, and a repository without one by the branch itself. */
function onDefaultBranch(status: GitStatus): boolean {
    return status.base !== null && status.branch === status.base.replace(/^origin\//, '');
}

function branchOf(status: GitStatus | null): string | null {
    return status?.repo === true ? status.branch : null;
}

/* A checkout says where it is once it is a worktree or off its own default branch, which differs per repository. */
function standsOut(status: GitStatus | null): status is GitStatus {
    if (status === null || branchOf(status) === null) {
        return false;
    }

    return status.worktree === true || !onDefaultBranch(status);
}

function repoRow(label: string, status: GitStatus): ComposerStatusDetail {
    const linked = status.worktree === true;

    return {
        icon: linked ? FolderGit2 : GitBranch,
        label: status.branch ?? '',
        mono: true,
        hint: label,
        ...(linked && status.root !== null ? { detail: status.root } : {}),
        ...(standsOut(status) ? {} : { muted: true })
    };
}

/*
 * The items of the line under a chat's composer: its branch, as one item with the worktree it is in,
 * and the machine on the right while that is another one. A checkout on its default branch outside a
 * worktree names no branch. A folder with several repositories names the branch the CLI works in and
 * counts the others that stand out; its popover has a row per repository. A node names its machine in
 * its head, so on the canvas the line does not.
 */
export function whereItems({ status, others, machine, onCanvas, t }: WhereInput): ComposerStatusItem[] {
    const items: ComposerStatusItem[] = [];
    const machineRow: ComposerStatusDetail[] = machine === null ? [] : [{ icon: Server, label: machine, hint: t('where.otherMachine') }];
    const listed = others.filter((other): other is { label: string; status: GitStatus } => branchOf(other.status) !== null);
    const outstanding = listed.filter((other) => standsOut(other.status));
    const branch = branchOf(status);

    if (listed.length === 0 && status !== null && branch !== null && standsOut(status)) {
        const linked = status.worktree === true;
        const root = status.root ?? '';

        items.push({
            id: 'branch',
            icon: linked ? FolderGit2 : GitBranch,
            label: branch,
            details: [
                { icon: GitBranch, label: branch, mono: true },
                linked
                    ? { icon: FolderGit2, label: t('where.worktree', { name: lastSegment(root) }), detail: root }
                    : { icon: Folder, label: t('where.mainCheckout') },
                ...machineRow
            ]
        });
    } else if (listed.length > 0 && (standsOut(status) || outstanding.length > 0)) {
        // The checkout the CLI works in leads; without one, the first repository that stands out does.
        const lead = branch !== null && status !== null ? { label: lastSegment(status.root ?? ''), status } : outstanding[0]!;
        const counted = outstanding.filter((other) => other !== lead).length;

        items.push({
            id: 'branch',
            icon: lead.status.worktree === true ? FolderGit2 : GitBranch,
            label: counted === 0 ? (lead.status.branch ?? '') : `${lead.status.branch ?? ''} +${counted}`,
            details: [lead, ...listed.filter((other) => other !== lead)].map((repo) => repoRow(repo.label, repo.status)).concat(machineRow)
        });
    }

    if (machine !== null && !onCanvas) {
        items.push({ id: 'machine', icon: Server, label: machine, side: 'end' });
    }

    return items;
}

/*
 * Where a chat works, read from the folder its CLI is in now, which moves when the agent goes into a
 * worktree itself, and from the other repositories of the folder it started in, such as submodules.
 */
export function useComposerStatus(endpointId: string, chatId: string): readonly ComposerStatusItem[] {
    const { t } = useTranslation('chat');
    const onCanvas = useContext(ChatOnCanvasContext);
    const cwd = useChatRow(chatId, (row) => row?.info.cwd ?? null);
    const workdir = useChatRow(chatId, (row) => row?.info.workdir ?? null);
    const status = useGitStatus(workdir ?? cwd);
    const { repos } = useProjectRepos(cwd);
    const { checkouts } = useGitCheckouts(repos);
    const entry = useMachineEntry(endpointId);
    const machine = isThisMachine(endpointId) ? null : nameOf(entry);

    // A CLI that went into a worktree of the folder's own repository has left that checkout behind.
    const left = status?.worktree === true && workdir !== null;
    const others = checkouts
        .filter((checkout) => checkout.path !== status?.root && !(left && checkout.kind === 'root'))
        .map((checkout) => ({ label: checkout.label, status: checkout.status }));

    return whereItems({ status, others, machine, onCanvas, t });
}
