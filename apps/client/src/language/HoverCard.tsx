import { useTranslation } from 'react-i18next';
import { CircleX, Info, TriangleAlert } from 'lucide-react';
import { fileUriToPath } from '@ruimte/smart-editor-lsp';
import { Button, Icon, Tooltip } from '@basmilius/desktop-ui';
import { openFileLink } from '@/shell/panels/file-links';
import { basenameOf } from '@/shell/panels/files-tree';
import type { EditorLanguage } from './editor-language';
import { codeLabelOf, severityOf, type Problem } from './diagnostics-model';

const SEVERITY_ICONS = { error: CircleX, warning: TriangleAlert, info: Info, hint: Info } as const;
const SEVERITY_COLORS = { error: 'text-status-error', warning: 'text-status-needs-you', info: 'text-status-running', hint: 'text-text-muted' } as const;

function ProblemSection({ problem, language }: { problem: Problem; language: EditorLanguage }) {
    const { t } = useTranslation('panels');
    const { diagnostic } = problem;
    const severity = severityOf(diagnostic);
    const label = [codeLabelOf(diagnostic), problem.server].filter((part, index, all) => part !== '' && all.indexOf(part) === index).join(' · ');
    const quickFix = language.quickFix;

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
                            <button
                                type="button"
                                className="font-mono text-accent hover:underline"
                                onClick={() => void openFileLink(language.project.folder, { path, line, directory: false })}
                            >
                                {basenameOf(path)}:{line}
                            </button>
                        ) : null}{' '}
                        {related.message}
                    </div>
                );
            })}
            <div className="flex items-center gap-1 pt-1 pl-[22px]">
                <Tooltip label={quickFix === null ? t('language.hover.quickFixSoon') : t('language.hover.quickFix')}>
                    <Button
                        size="xs"
                        variant="secondary"
                        aria-disabled={quickFix === null}
                        onClick={() => {
                            if (quickFix !== null) {
                                quickFix(problem);
                            }
                        }}
                    >
                        {t('language.hover.quickFix')}
                    </Button>
                </Tooltip>
            </div>
        </div>
    );
}

/* What the pointer rests on: the problems of the character, worst first, each with where it came from and what it points at. */
export function HoverCard({ language, problems }: { language: EditorLanguage; problems: readonly Problem[] }) {
    return (
        <div className="flex w-[360px] max-w-[min(480px,calc(100vw-16px))] flex-col divide-y divide-border">
            {problems.map((problem, index) => (
                <ProblemSection key={index} problem={problem} language={language} />
            ))}
        </div>
    );
}
