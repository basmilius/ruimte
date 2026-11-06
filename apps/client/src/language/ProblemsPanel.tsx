import type { EditorPosition } from '@adecore/editor';
import { countsOf, createHolder, type ProblemFile } from '@adecore/editor-react';
import { codeLabelOf, severityOf } from '@adecore/editor-react/models';
import { pathToFileUri } from '@adecore/lsp';
import { Button, ButtonGroup, Icon, IconButton, PanelEmpty, ScrollArea } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { resolveStoredPath, type LanguageServerStatus } from '@ruimte/contracts';
import { CircleX, Info, ScanSearch, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelHeaderActions, PanelHeaderSlot } from '@/shell/PanelHeaderSlot';
import { basenameOf } from '@/shell/panels/files-tree';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useTransport } from '@/transport/context';
import { useMachineAnswers } from '@/transport/features';
import { ProblemsScene } from '@/ui/EmptyScenes';
import { draftFiles } from './project-files';
import { acquireProjectLanguage, type ProjectLanguage } from './ruimte-project-language';
import { report } from './server-status';
import { offersWorkspaceProblems } from './status-view';

const SEVERITIES = ['error', 'warning', 'info'] as const;
type Severity = (typeof SEVERITIES)[number];

const ICONS = { error: CircleX, warning: TriangleAlert, info: Info } as const;
const COLORS = { error: 'text-status-error', warning: 'text-status-needs-you', info: 'text-status-running' } as const;

/* The language side of the project for as long as the panel is up, so what the servers report is heard while it is. */
function useProjectLanguage(): ProjectLanguage | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((state) => state.current?.projectId ?? null);
    const folder = useProject((state) => state.current?.folder ?? null);
    const [holder] = useState(createHolder<ProjectLanguage>);

    useEffect(() => {
        if (projectId === null || folder === null) {
            return;
        }
        const held = acquireProjectLanguage(transport, projectId, folder, draftFiles(endpointId, transport, projectId));
        holder.set(held.language);
        return () => {
            holder.set(null);
            held.release();
        };
    }, [transport, endpointId, projectId, folder, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}

const NONE: readonly ProblemFile[] = [];

const NO_STATUSES: readonly LanguageServerStatus[] = [];

/*
 * The problems every language server reports for the files of the project that are open, a file at a time,
 * worst first. Files nobody has open appear after a whole-project check, which a person asks for and which
 * only servers that report for the whole project answer. A press on a problem opens its file at the line.
 */
export function ProblemsPanel() {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const folder = useProject((state) => state.current?.folder ?? null);
    const language = useProjectLanguage();
    const files = useSyncExternalStore(language?.problems.subscribe ?? (() => () => undefined), language?.problems.getSnapshot ?? (() => NONE));
    const tracker = language?.status ?? null;
    const statuses = useSyncExternalStore(
        (listener) => tracker?.subscribe(listener) ?? (() => undefined),
        () => tracker?.getSnapshot() ?? NO_STATUSES
    );
    const canCheckProject = useMachineAnswers(endpointId, 'language.workspaceProblems') && offersWorkspaceProblems(statuses);
    const [checking, setChecking] = useState(false);
    const [checked, setChecked] = useState(false);
    const [filter, setFilter] = useState('');
    const [hidden, setHidden] = useState<ReadonlySet<Severity>>(new Set());
    const counts = countsOf(files);

    const needle = filter.trim().toLowerCase();
    const shown = files
        .map((file) => ({
            ...file,
            rows: file.rows.filter(
                (row) =>
                    !hidden.has(severityOf(row.diagnostic) as Severity) &&
                    (needle === '' || row.diagnostic.message.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle))
            )
        }))
        .filter((file) => file.rows.length > 0);

    function toggle(severity: Severity): void {
        const next = new Set(hidden);
        if (!next.delete(severity)) {
            next.add(severity);
        }
        setHidden(next);
    }

    async function checkProject(): Promise<void> {
        if (language === null || checking) {
            return;
        }

        setChecking(true);

        try {
            await language.pullWorkspaceProblems('');
            setChecked(true);
        } catch (error) {
            report(error, t);
        } finally {
            setChecking(false);
        }
    }

    function open(path: string, position: EditorPosition): void {
        const absolute = folder === null ? null : resolveStoredPath(folder, path);
        if (absolute !== null) {
            language?.jumpTo({ uri: pathToFileUri(absolute), position });
        }
    }

    return (
        <>
            <PanelHeaderSlot>
                <PanelHeaderActions>
                    {canCheckProject && (
                        <ButtonGroup>
                            <IconButton
                                icon={ScanSearch}
                                size="xs"
                                busy={checking}
                                label={t('problems.workspace')}
                                tooltip={t('problems.workspaceHint')}
                                onClick={() => void checkProject()}
                            />
                        </ButtonGroup>
                    )}
                    <ButtonGroup>
                        {SEVERITIES.map((severity) => (
                            <button
                                key={severity}
                                type="button"
                                aria-pressed={!hidden.has(severity)}
                                className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs hover:bg-surface-hover ${hidden.has(severity) ? 'opacity-50' : ''}`}
                                onClick={() => toggle(severity)}
                            >
                                <Icon icon={ICONS[severity]} size={12} className={COLORS[severity]} />
                                <span aria-label={t(`problems.${severity}`, { count: counts[severity], formatted: formatNumber(counts[severity]) })}>
                                    {formatNumber(counts[severity])}
                                </span>
                            </button>
                        ))}
                    </ButtonGroup>
                </PanelHeaderActions>
            </PanelHeaderSlot>
            {files.length === 0 ? (
                <PanelEmpty
                    scene={<ProblemsScene />}
                    title={t('problems.emptyTitle')}
                    action={
                        canCheckProject && !checked ? (
                            <Button size="sm" variant="secondary" disabled={checking} onClick={() => void checkProject()}>
                                <Icon icon={ScanSearch} size={14} /> {t('problems.workspace')}
                            </Button>
                        ) : undefined
                    }
                >
                    {checked ? t('problems.emptyProject') : t('problems.empty')}
                </PanelEmpty>
            ) : (
                <div className="flex min-h-0 grow flex-col">
                    <div className="relative shrink-0 border-b border-border p-2">
                        <Icon icon={Search} size={12} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-faint" />
                        <input
                            value={filter}
                            placeholder={t('problems.filter')}
                            spellCheck={false}
                            className="field field-sm w-full pl-7"
                            onChange={(event) => setFilter(event.target.value)}
                        />
                    </div>
                    <ScrollArea className="grow" viewportClassName="pb-2">
                        {shown.length === 0 && <div className="px-3 py-4 text-center text-xs text-text-muted">{t('problems.nothingMatches')}</div>}
                        {shown.map((file) => {
                            const name = basenameOf(file.path);
                            const place = file.path.slice(0, Math.max(0, file.path.length - name.length)).replace(/\/$/, '');
                            return (
                                <div key={file.path}>
                                    <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs">
                                        <span className="font-medium">{name}</span>
                                        <span className="min-w-0 truncate font-mono text-text-faint">{place}</span>
                                        <span className="ml-auto shrink-0 rounded-full bg-surface-hover px-1.5 text-text-muted">
                                            {formatNumber(file.rows.length)}
                                        </span>
                                    </div>
                                    {file.rows.map((row, index) => {
                                        const severity = severityOf(row.diagnostic) as Severity;
                                        const { start } = row.diagnostic.range;
                                        const label = [codeLabelOf(row.diagnostic), row.server]
                                            .filter((part, at, all) => part !== '' && all.indexOf(part) === at)
                                            .join(' · ');
                                        return (
                                            <button
                                                key={index}
                                                type="button"
                                                className="flex w-full items-start gap-2 px-3 py-1 text-left text-xs hover:bg-surface-hover"
                                                onClick={() => open(file.path, start)}
                                            >
                                                <Icon icon={ICONS[severity]} size={14} className={`mt-px shrink-0 ${COLORS[severity]}`} />
                                                <span className="min-w-0 grow break-words">
                                                    {row.diagnostic.message.split('\n')[0]} <span className="text-text-faint">{label}</span>
                                                </span>
                                                <span className="shrink-0 font-mono text-text-faint">
                                                    {formatNumber(start.line + 1)}:{formatNumber(start.character + 1)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </ScrollArea>
                </div>
            )}
        </>
    );
}
