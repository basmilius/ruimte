import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, Copy, Trash2 } from 'lucide-react';
import { useFormatLocale } from '@/format/locale';
import { formatBytes, formatDecimal, formatNumber, formatPercent } from '@/format/number';
import { Button } from '@/ui/Button';
import { copyText } from '@/ui/clipboard';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { summarizeVoiceSessions, type VoiceCount, type VoiceLatency } from '@/voice/diagnostics-summary';
import { clearVoiceDiagnostics, MAX_STORED_SESSIONS, useVoiceDiagnostics } from '@/voice/diagnostics-store';

const COPIED_MS = 1_500;
const MOST_USED = 5;

/* Latency sits well below a second, where the whole seconds of `formatDuration` would read as nothing. */
const formatLatency = (ms: number): string => (ms < 1000 ? `${formatNumber(ms)} ms` : `${formatDecimal(ms / 1000)} s`);

const share = (value: number | null): string => formatPercent((value ?? 0) * 100);

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-text-muted">{label}</span>
            <span className="min-w-0 text-right text-text tabular-nums">{children}</span>
        </div>
    );
}

function Counts({ counts }: { counts: VoiceCount[] }) {
    return (
        <ul className="space-y-0.5 pl-3">
            {counts.map((count) => (
                <li key={count.name} className="flex items-baseline justify-between gap-3 text-text-muted">
                    <span className="min-w-0 truncate font-mono">{count.name}</span>
                    <span className="shrink-0 tabular-nums">
                        {formatPercent(count.share * 100)} ({formatNumber(count.count)})
                    </span>
                </li>
            ))}
        </ul>
    );
}

function Latency({ label, latency }: { label: string; latency: VoiceLatency }) {
    const { t } = useTranslation('voice');
    if (latency.medianMs === null || latency.slowestMs === null) {
        return null;
    }
    return <Row label={label}>{t('diagnostics.latency', { median: formatLatency(latency.medianMs), slowest: formatLatency(latency.slowestMs) })}</Row>;
}

function DiagnosticsBody() {
    const { t } = useTranslation('voice');
    const history = useVoiceDiagnostics((state) => state.history);
    const current = useVoiceDiagnostics((state) => state.current);
    useFormatLocale();
    const sessions = useMemo(() => (current ? [...history, current] : history), [history, current]);
    const summary = useMemo(() => summarizeVoiceSessions(sessions), [sessions]);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) {
            return;
        }
        const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
        return () => window.clearTimeout(timer);
    }, [copied]);

    function copy() {
        copyText(JSON.stringify({ summary, sessions }, null, 2));
        setCopied(true);
    }

    return (
        <div className="space-y-3 pt-2 text-xs">
            {summary.requests === 0 ? (
                <p className="text-text-muted">{t('diagnostics.empty')}</p>
            ) : (
                <div className="space-y-1.5">
                    <Row label={t('diagnostics.requests')}>
                        {t('diagnostics.requestsValue', { requests: formatNumber(summary.requests), answered: formatNumber(summary.answered) })}
                    </Row>
                    <Row label={t('diagnostics.sessions')}>{formatNumber(summary.sessions)}</Row>
                    {summary.callsPerRequest !== null && (
                        <Row label={t('diagnostics.callsPerRequest')}>
                            {t('diagnostics.callsPerRequestValue', {
                                average: formatDecimal(summary.callsPerRequest),
                                most: formatNumber(summary.mostCallsInRequest)
                            })}
                        </Row>
                    )}
                    {summary.failedShare !== null && <Row label={t('diagnostics.failed')}>{share(summary.failedShare)}</Row>}
                    {summary.results.length > 0 && (
                        <>
                            <p className="text-text-muted">{t('diagnostics.results')}</p>
                            <Counts counts={summary.results} />
                        </>
                    )}
                    {summary.targets.resolves > 0 && (
                        <>
                            <Row label={t('diagnostics.targets')}>
                                {t('diagnostics.targetsValue', {
                                    ambiguous: share(summary.targets.ambiguousShare),
                                    missing: share(summary.targets.missingShare)
                                })}
                            </Row>
                            <p className="pl-3 text-right text-text-muted tabular-nums">
                                {t('diagnostics.found', {
                                    count: summary.targets.resolves,
                                    resolves: formatNumber(summary.targets.resolves),
                                    one: share(summary.targets.oneShare),
                                    several: share(summary.targets.severalShare),
                                    none: share(summary.targets.noneShare)
                                })}
                            </p>
                        </>
                    )}
                    <Latency label={t('diagnostics.response')} latency={summary.latency.response} />
                    <Latency label={t('diagnostics.call')} latency={summary.latency.call} />
                    <Latency label={t('diagnostics.answer')} latency={summary.latency.answer} />
                    {summary.actions.length > 0 && (
                        <>
                            <p className="text-text-muted">{t('diagnostics.mostUsed')}</p>
                            <Counts counts={summary.actions.slice(0, MOST_USED)} />
                        </>
                    )}
                </div>
            )}
            {summary.latest && (
                <div className="space-y-1.5">
                    <Row label={t('diagnostics.toolsSent')}>
                        {t('diagnostics.toolsSentValue', {
                            count: summary.latest.toolCount,
                            tools: formatNumber(summary.latest.toolCount),
                            size: formatBytes(summary.latest.toolBytes)
                        })}
                    </Row>
                    <p className="font-mono break-words text-text-muted">{summary.latest.domains.join(', ')}</p>
                </div>
            )}
            <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={sessions.length === 0} onClick={copy}>
                    <Icon icon={copied ? Check : Copy} size={13} />
                    {copied ? t('diagnostics.copied') : t('diagnostics.copy')}
                </Button>
                <Button size="sm" variant="ghost" disabled={summary.requests === 0 && history.length === 0} onClick={clearVoiceDiagnostics}>
                    <Icon icon={Trash2} size={13} />
                    {t('diagnostics.clear')}
                </Button>
            </div>
            <p className="text-text-faint">{t('diagnostics.privacy', { sessions: formatNumber(MAX_STORED_SESSIONS) })}</p>
        </div>
    );
}

/* How well Voice picks and runs its tools, for a person who wants to know; closed until asked. */
export function VoiceDiagnostics() {
    const { t } = useTranslation('voice');
    const [open, setOpen] = useState(false);
    const size = useVoiceDiagnostics((state) => state.history.length + (state.current?.requests.length ?? 0));

    return (
        <div className="mb-3">
            <button
                className="-mx-1 flex items-center gap-1 rounded-md px-1 text-xs text-text-muted hover:text-text"
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                <Icon icon={ChevronRight} size={13} className={clsx('transition-transform', open && 'rotate-90')} />
                {t('diagnostics.title')}
            </button>
            {open && (
                <div className="max-h-72 overflow-y-auto">
                    <ErrorBoundary label={t('diagnostics.failedToShow')} resetKeys={[size]} compact className="relative">
                        <DiagnosticsBody />
                    </ErrorBoundary>
                </div>
            )}
        </div>
    );
}
