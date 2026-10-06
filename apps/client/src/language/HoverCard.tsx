import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { CircleX, Cpu, Info, TriangleAlert } from 'lucide-react';
import { fileUriToPath } from '@adecore/lsp';
import { AgentIcon } from '@adecore/agents-react/agents/AgentIcon';
import { Button, Icon, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { basenameOf } from '@/shell/panels/files-tree';
import type { EditorPosition } from '@adecore/editor';
import { useAskAgents } from './ask-agents';
import type { EditorLanguage } from './editor-language';
import type { ExplainView } from './explain';
import { codeLabelOf, severityOf, type Problem } from './diagnostics-model';
import type { HoverInfo } from './popups';
import { nameOf } from './status-view';
import { SymbolSections } from './HoverSections';

const SEVERITY_ICONS = { error: CircleX, warning: TriangleAlert, info: Info, hint: Info } as const;
const SEVERITY_COLORS = { error: 'text-status-error', warning: 'text-status-needs-you', info: 'text-status-running', hint: 'text-text-muted' } as const;

function ProblemSection({ problem, language }: { problem: Problem; language: EditorLanguage }) {
    const { t } = useTranslation('panels');
    const { t: chat } = useTranslation('chat');
    const agents = useAskAgents();
    const { diagnostic } = problem;
    const severity = severityOf(diagnostic);
    // A source already says where a problem comes from; the server only names one that has none.
    const label =
        diagnostic.source === undefined ? [codeLabelOf(diagnostic), nameOf(problem.server)].filter((part) => part !== '').join(' · ') : codeLabelOf(diagnostic);
    const supported = language.codeActions.supported;

    return (
        <div className="flex flex-col gap-1.5 px-3 py-2.5">
            <div className="flex items-start gap-2">
                <Icon icon={SEVERITY_ICONS[severity]} size={14} className={`mt-px shrink-0 ${SEVERITY_COLORS[severity]}`} />
                <div className="min-w-0 text-xs/[18px] break-words whitespace-pre-wrap select-text">{diagnostic.message}</div>
            </div>
            {label !== '' && <div className="pl-[22px] text-xs text-text-muted select-text">{label}</div>}
            {diagnostic.relatedInformation?.map((related, index) => {
                const path = fileUriToPath(related.location.uri);
                const line = related.location.range.start.line + 1;
                return (
                    <div key={index} className="pl-[22px] text-xs text-text-muted">
                        {path !== null ? (
                            <button type="button" className="font-mono text-accent hover:underline" onClick={() => language.goTo(related.location)}>
                                {basenameOf(path)}:{line}
                            </button>
                        ) : null}{' '}
                        {related.message}
                    </div>
                );
            })}
            <div className="flex flex-wrap items-center gap-1 pt-1 pl-[22px]">
                <Tooltip label={supported ? t('language.hover.quickFix') : t('language.hover.quickFixNone')}>
                    <Button
                        size="xs"
                        variant="secondary"
                        aria-disabled={!supported}
                        onClick={() => {
                            if (supported) {
                                language.hover.hide();
                                void language.codeActions.quickFixFor(problem);
                            }
                        }}
                    >
                        {t('language.hover.quickFix')}
                    </Button>
                </Tooltip>
                {agents.map((agent) => (
                    <Button
                        key={agent.kind}
                        size="xs"
                        variant="secondary"
                        onClick={() => {
                            language.hover.hide();
                            language.selectionChat.askAboutProblem(problem, agent.kind);
                        }}
                    >
                        <AgentIcon kind={agent.kind} size={12} />
                        {chat('selection.ask', { provider: agent.name })}
                    </Button>
                ))}
            </div>
        </div>
    );
}

/* The explanation the model on the machine wrote, which fills in as it streams. */
function ExplainSection({ view }: { view: ExplainView }) {
    const { t } = useTranslation('panels');
    return (
        <div className="flex flex-col gap-1.5 px-3 pt-2.5 pb-3">
            <Tooltip label={t('language.onDevice.note')}>
                <span className="flex items-center gap-1.5 text-xs text-text-faint">
                    <Icon icon={Cpu} size={12} className="shrink-0" />
                    {t('language.onDevice.explanation')}
                </span>
            </Tooltip>
            {view.phase === 'error' ? (
                <div role="alert" className="text-xs/[19px] break-words text-status-error">
                    {view.error}
                </div>
            ) : (
                <div className={`text-xs/[19px] break-words whitespace-pre-wrap select-text ${view.text === '' ? 'text-text-faint' : 'text-text'}`}>
                    {view.text === '' ? t('language.onDevice.thinking') : view.text}
                </div>
            )}
        </div>
    );
}

function InfoSection({
    language,
    info,
    anchor,
    position,
    explain
}: {
    language: EditorLanguage;
    info: HoverInfo;
    anchor: EditorPosition;
    position: EditorPosition;
    explain: ExplainView;
}) {
    const { t } = useTranslation('panels');
    const { text, definition } = info;
    const place = definition === null ? null : fileUriToPath(definition.uri);

    // The name a signature declares is the symbol under the pointer, whose definition is known; any other name is looked up.
    function followName(name: string, declared: string | null): void {
        const own = name === (declared ?? info.word) ? definition : null;
        language.hover.hide();
        void language.navigation.goToName(name, anchor, own);
    }

    return (
        <div className="flex flex-col divide-y divide-border">
            <SymbolSections text={text} onName={followName} />
            {explain.phase !== 'idle' && <ExplainSection view={explain} />}
            {(definition !== null || explain.offered) && (
                <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs">
                    {definition !== null && (
                        <button type="button" className="text-accent hover:underline" onClick={() => language.goTo(definition)}>
                            {t('language.hover.definition')}
                        </button>
                    )}
                    {info.references !== null && info.references > 0 && (
                        <button
                            type="button"
                            className="text-accent hover:underline"
                            onClick={() => {
                                language.hover.hide();
                                void language.peek.open(position);
                            }}
                        >
                            {t('language.hover.references', { count: info.references, formatted: formatNumber(info.references) })}
                        </button>
                    )}
                    {explain.offered && (
                        <Tooltip label={t('language.onDevice.note')}>
                            <button type="button" className="text-accent hover:underline" onClick={() => void language.explain.explainCard()}>
                                {t('language.onDevice.explain')}
                            </button>
                        </Tooltip>
                    )}
                    {place !== null && definition !== null && (
                        <span className="ml-auto font-mono text-text-faint">
                            {basenameOf(place)}:{definition.range.start.line + 1}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

/* What the pointer rests on: what the servers say about the symbol, then the problems of the character, worst first. */
export function HoverCard({
    language,
    problems,
    info,
    anchor,
    position
}: {
    language: EditorLanguage;
    problems: readonly Problem[];
    info: HoverInfo | null;
    anchor: EditorPosition;
    position: EditorPosition;
}) {
    const explain = useStore(language.explain.store);
    return (
        <div className="flex w-max min-w-[280px] max-w-[min(520px,calc(100vw-16px))] flex-col divide-y divide-border">
            {info !== null && <InfoSection language={language} info={info} anchor={anchor} position={position} explain={explain} />}
            {info === null && explain.phase !== 'idle' && <ExplainSection view={explain} />}
            {problems.map((problem, index) => (
                <ProblemSection key={index} problem={problem} language={language} />
            ))}
        </div>
    );
}
