import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitCompareMode, GitRef, GitRepo } from '@ruimte/contracts';
import { Button, Dialog, ErrorBoundary, Select, FormError, EmptyState, messageOf } from '@adecore/ui';
import { useProject } from '@/state/project';
import { useEndpointId } from '@/state/keys';
import { useEndpointConnection } from '@/transport/status';
import { machineAnswers } from '@/transport/features';
import { machineTransport } from '@/transport';
import { basenameOf } from './files-tree';
import { closeBranchCompare, openComparison, refLabel, fullRefName, useBranchCompare } from './branch-compare';

function Picker({ seed }: { seed: NonNullable<ReturnType<typeof useBranchCompare.getState>['request']> }) {
    const { t } = useTranslation('panels');
    const transport = machineTransport(seed.endpointId);
    const folder = useProject((state) => state.current?.folder ?? null);
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState(seed.cwd ?? '');
    const [from, setFrom] = useState(seed.from ?? '');
    const [to, setTo] = useState(seed.to ?? '');
    const [mode, setMode] = useState<GitCompareMode>(seed.mode ?? 'merge-base');
    const [repos, setRepos] = useState<GitRepo[] | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    useEffect(() => {
        if (folder === null) {
            return;
        }
        let alive = true;
        void transport.request('git.repos', { folder }).then(
            ({ repos: listed }) => {
                if (alive) {
                    const rows =
                        seed.cwd && !listed.some((repo) => repo.path === seed.cwd)
                            ? [...listed, { path: seed.cwd, label: basenameOf(seed.cwd), kind: 'nested' as const }]
                            : listed;
                    setRepos(rows);
                    setFailure(null);
                }
            },
            (error: unknown) => {
                if (alive) {
                    setFailure(messageOf(error));
                }
            }
        );
        return () => {
            alive = false;
        };
    }, [transport, folder, seed.cwd, retry]);
    const cwd = selected || (repos?.length === 1 ? repos[0]!.path : '');
    const [held, setHeld] = useState<{ cwd: string; refs: GitRef[]; error: string | null } | null>(null);
    useEffect(() => {
        if (cwd === '') {
            return;
        }
        let alive = true;
        void transport.request('git.refs', { cwd }).then(
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
    }, [transport, cwd, retry]);
    const refs = held?.cwd === cwd ? held.refs : null;
    const referenceItems = [
        { value: 'HEAD', label: 'HEAD' },
        ...(refs ?? []).map((ref) => ({ value: fullRefName(ref), label: ref.name + (ref.worktree ? ` · ${t('git.branchMenu.inWorktree')}` : '') }))
    ];
    const defaultFrom = refs?.find((ref) => ref.isDefault) ?? refs?.[0];
    const left = from || (defaultFrom === undefined ? 'HEAD' : fullRefName(defaultFrom));
    const right = to || (refs?.find((ref) => ref.current) ? fullRefName(refs.find((ref) => ref.current)!) : 'HEAD');
    for (const value of [left, right]) {
        if (!referenceItems.some((item) => item.value === value)) {
            referenceItems.push({ value, label: refLabel(value) });
        }
    }
    const error = failure ?? (held?.cwd === cwd ? held.error : null);
    const canCompare = cwd !== '' && refs !== null && error === null;
    return (
        <>
            <Dialog.Text>{t('git.compare.description')}</Dialog.Text>
            <div className="mt-4 flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted">{t('git.compare.repository')}</span>
                    <Select
                        className="w-full max-w-none"
                        label={t('git.compare.repository')}
                        value={cwd}
                        items={(repos ?? []).map((repo) => ({ value: repo.path, label: repo.label || basenameOf(repo.path) }))}
                        placeholder={t('git.compare.repository')}
                        disabled={repos === null}
                        onValueChange={(value) => {
                            setSelected(value);
                            setFrom('');
                            setTo('');
                            setHeld(null);
                        }}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted">{t('git.compare.from')}</span>
                    <Select
                        className="w-full max-w-none"
                        label={t('git.compare.from')}
                        value={left}
                        items={referenceItems}
                        searchable={10}
                        disabled={refs === null}
                        onValueChange={setFrom}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted">{t('git.compare.to')}</span>
                    <Select
                        className="w-full max-w-none"
                        label={t('git.compare.to')}
                        value={right}
                        items={referenceItems}
                        searchable={10}
                        disabled={refs === null}
                        onValueChange={setTo}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted">{t('git.compare.mode')}</span>
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
                </div>
            </div>
            {repos === null && error === null && <EmptyState busy>{t('git.compare.loadingRefs')}</EmptyState>}
            {error !== null && (
                <div className="mt-3">
                    <FormError>{error}</FormError>
                    <Button size="sm" onClick={() => setRetry((count) => count + 1)}>
                        {t('common:action.retry')}
                    </Button>
                </div>
            )}
            <p className="mt-3 text-xs text-text-faint">{t('git.compare.session')}</p>
            <div className="mt-5 flex justify-end gap-2">
                <Button onClick={closeBranchCompare}>{t('common:action.cancel')}</Button>
                <Button
                    variant="primary"
                    disabled={!canCompare}
                    onClick={() => {
                        openComparison(cwd, left, right, mode);
                        closeBranchCompare();
                    }}
                >
                    {t('git.compare.open')}
                </Button>
            </div>
        </>
    );
}

export function BranchCompareDialog() {
    const { t } = useTranslation('panels');
    const request = useBranchCompare((state) => state.request);
    const projectId = useProject((state) => state.current?.projectId ?? null);
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const matches = request !== null && request.endpointId === endpointId && request.projectId === projectId;
    useEffect(() => {
        if (request !== null && !matches) {
            closeBranchCompare();
        }
    }, [request, matches]);
    return (
        <Dialog.Root open={matches} onOpenChange={(open) => !open && closeBranchCompare()}>
            <Dialog.Popup size="sm">
                <Dialog.Title>{t('git.compare.title')}</Dialog.Title>
                {connection.status !== 'open' ? (
                    <Dialog.Text>{t('git.compare.offline')}</Dialog.Text>
                ) : !machineAnswers(connection, 'git.compare') ? (
                    <Dialog.Text>{t('git.compare.update')}</Dialog.Text>
                ) : (
                    matches && (
                        <ErrorBoundary label={t('git.compare.failed')} resetKeys={[request.key]} compact className="relative">
                            <Picker key={request.key} seed={request} />
                        </ErrorBoundary>
                    )
                )}
            </Dialog.Popup>
        </Dialog.Root>
    );
}
