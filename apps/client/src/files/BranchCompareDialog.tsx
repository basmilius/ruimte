import { Button, Dialog, EmptyState, ErrorBoundary, FormError, Select, messageOf } from '@adecore/ui';
import type { GitCompareMode, GitRef } from '@ruimte/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { useProjectRepos } from '@/controllers/git-repos';
import { closeBranchCompare, fullRefName, openComparison, useBranchCompare, type BranchCompareSeed } from '@/files/branch-compare';
import { basenameOf } from '@/paths/file-path';
import { useEndpointId } from '@/state/current-endpoint';
import { shownFolderOf, useProject } from '@/state/project';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';
import { refLabel } from '@/worktree-rules/ref-label';

type RefsState = { cwd: string; refs: readonly GitRef[]; error: string | null };

function useRefs(cwd: string): { refs: readonly GitRef[] | null; error: string | null; retry(): void } {
    const [retries, setRetries] = useState(0);
    const [held, setHeld] = useState<RefsState | null>(null);

    useEffect(() => {
        if (cwd === '') {
            return;
        }

        let alive = true;

        perform('git.refs', { repository: cwd }).then(
            ({ refs }) => {
                if (alive) {
                    setHeld({ cwd, refs, error: null });
                }
            },
            (error: unknown) => {
                if (alive) {
                    setHeld({ cwd, refs: [], error: messageOf(error) });
                }
            }
        );

        return () => {
            alive = false;
        };
    }, [cwd, retries]);

    const current = held?.cwd === cwd ? held : null;

    return { refs: current?.refs ?? null, error: current?.error ?? null, retry: () => setRetries((count) => count + 1) };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">{label}</span>
            {children}
        </div>
    );
}

function Picker({ seed }: { seed: BranchCompareSeed }) {
    const { t } = useTranslation('panels');
    const folder = useProject((state) => shownFolderOf(state.current));
    const { repos } = useProjectRepos(folder);
    const [chosen, setChosen] = useState(seed.cwd ?? '');
    const [from, setFrom] = useState(seed.from ?? '');
    const [to, setTo] = useState(seed.to ?? '');
    const [mode, setMode] = useState<GitCompareMode>(seed.mode ?? 'merge-base');
    // A repository the dialog was asked for may sit outside the folder's list, such as a worktree.
    const listed =
        chosen === '' || repos.some((repo) => repo.path === chosen) ? repos : [...repos, { path: chosen, label: basenameOf(chosen), kind: 'nested' as const }];
    const cwd = chosen !== '' ? chosen : repos.length === 1 ? repos[0]!.path : '';
    const { refs, error, retry } = useRefs(cwd);

    // A git ref's `current` flag, read by destructuring so the compiler does not take it for a React ref.
    const current = refs?.find(({ current: checkedOut }) => checkedOut);
    const items = (refs ?? []).map((branch) => ({
        value: fullRefName(branch),
        // The checkout the dialog reads is in a worktree list too, but it is not another worktree.
        label: branch.worktree === undefined || branch === current ? branch.name : `${branch.name} (${t('git.branchMenu.inWorktree')})`
    }));
    const base = refs?.find((ref) => ref.isDefault) ?? refs?.[0];
    const left = from !== '' ? from : base === undefined ? 'HEAD' : fullRefName(base);
    const right = to !== '' ? to : current === undefined ? 'HEAD' : fullRefName(current);

    // A seed or HEAD may name a ref the list does not carry, such as a branch past the menu's limit.
    for (const value of ['HEAD', left, right]) {
        if (!items.some((item) => item.value === value)) {
            items.push({ value, label: refLabel(value) });
        }
    }

    const ready = cwd !== '' && refs !== null && error === null;

    return (
        <>
            <Dialog.Text className="mt-1">{t('git.compare.description')}</Dialog.Text>
            <div className="mt-4 flex flex-col gap-3">
                <Field label={t('git.compare.repository')}>
                    <Select
                        className="w-full max-w-none"
                        label={t('git.compare.repository')}
                        value={cwd === '' ? null : cwd}
                        items={listed.map((repo) => ({ value: repo.path, label: repo.label || basenameOf(repo.path) }))}
                        placeholder={repos.length === 0 ? t('git.compare.noRepository') : t('git.compare.chooseRepository')}
                        disabled={listed.length === 0}
                        onValueChange={(value) => {
                            setChosen(value);
                            setFrom('');
                            setTo('');
                        }}
                    />
                </Field>
                <Field label={t('git.compare.from')}>
                    <Select
                        className="w-full max-w-none"
                        label={t('git.compare.from')}
                        value={ready ? left : null}
                        items={items}
                        searchable={10}
                        disabled={!ready}
                        onValueChange={setFrom}
                    />
                </Field>
                <Field label={t('git.compare.to')}>
                    <Select
                        className="w-full max-w-none"
                        label={t('git.compare.to')}
                        value={ready ? right : null}
                        items={items}
                        searchable={10}
                        disabled={!ready}
                        onValueChange={setTo}
                    />
                </Field>
                <Field label={t('git.compare.mode')}>
                    <Select
                        className="w-full max-w-none"
                        label={t('git.compare.mode')}
                        value={mode}
                        items={[
                            { value: 'merge-base', label: t('git.compare.mergeBase') },
                            { value: 'tips', label: t('git.compare.tips') }
                        ]}
                        onValueChange={(value) => setMode(value as GitCompareMode)}
                    />
                </Field>
            </div>
            {cwd !== '' && refs === null && error === null && <EmptyState busy>{t('git.compare.loadingRefs')}</EmptyState>}
            {error !== null && (
                <div className="mt-3 flex flex-col items-start gap-2">
                    <FormError>{error}</FormError>
                    <Button size="sm" onClick={retry}>
                        {t('common:action.retry')}
                    </Button>
                </div>
            )}
            <p className="mt-3 text-xs text-text-faint">{t('git.compare.session')}</p>
            <Dialog.Footer>
                <Button onClick={closeBranchCompare}>{t('common:action.cancel')}</Button>
                <Button
                    variant="primary"
                    disabled={!ready}
                    onClick={() => {
                        openComparison(cwd, left, right, mode);
                        closeBranchCompare();
                    }}
                >
                    {t('git.compare.open')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

/*
 * Chooses a repository, two refs and a mode, and opens the comparison as a tab. It reads refs as the
 * machine last fetched them and never fetches, and it explains a machine that cannot answer.
 */
export function BranchCompareDialog() {
    const { t } = useTranslation('panels');
    const request = useBranchCompare((state) => state.request);
    const projectId = useProject((state) => state.current?.projectId ?? null);
    const connection = useEndpointConnection(useEndpointId());
    const open = request !== null && request.projectId === projectId;

    useEffect(() => {
        if (request !== null && !open) {
            closeBranchCompare();
        }
    }, [request, open]);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && closeBranchCompare()}>
            <Dialog.Popup size="sm">
                <Dialog.Title>{t('git.compare.title')}</Dialog.Title>
                {connection.status !== 'open' ? (
                    <Dialog.Text className="mt-1">{t('git.compare.offline')}</Dialog.Text>
                ) : !machineAnswers(connection, 'git.compare') ? (
                    <Dialog.Text className="mt-1">{t('git.compare.update')}</Dialog.Text>
                ) : (
                    open && (
                        <ErrorBoundary label={t('git.compare.failed')} resetKeys={[request.key]} compact className="relative">
                            <Picker key={request.key} seed={request} />
                        </ErrorBoundary>
                    )
                )}
            </Dialog.Popup>
        </Dialog.Root>
    );
}
