import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@ruimte/agents-react/chat/ui/Markdown';
import { CircleX, Info, TriangleAlert } from 'lucide-react';
import { fileUriToPath } from '@ruimte/smart-editor-lsp';
import { Button, Icon, Tooltip } from '@basmilius/desktop-ui';
import { openFileLink } from '@/shell/panels/file-links';
import { highlightCode } from '@/shell/panels/highlight';
import { useCodeTheme } from '@/state/code-theme';
import { basenameOf } from '@/shell/panels/files-tree';
import type { EditorLanguage } from './editor-language';
import { codeLabelOf, severityOf, type Problem } from './diagnostics-model';
import type { HoverInfo } from './popups';

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

/* Code as the viewer colors it, plain until the grammar is in so the card never changes size under the pointer by much. */
function Signature({ code, language }: { code: string; language: string }) {
    const theme = useCodeTheme();
    const [html, setHtml] = useState<{ key: string; html: string } | null>(null);
    const key = `${language}\0${theme}\0${code}`;

    useEffect(() => {
        let alive = true;
        highlightCode(code, language, theme)
            .then((result) => alive && setHtml({ key, html: result }))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [code, language, theme, key]);

    const className =
        'font-mono text-code break-words whitespace-pre-wrap [&_.line]:block [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:whitespace-pre-wrap [&_code]:font-mono';
    return html?.key === key ? <div className={className} dangerouslySetInnerHTML={{ __html: html.html }} /> : <div className={className}>{code}</div>;
}

function InfoSection({ language, info }: { language: EditorLanguage; info: HoverInfo }) {
    const { t } = useTranslation('panels');
    const { text, definition } = info;
    const place = definition === null ? null : fileUriToPath(definition.uri);

    return (
        <div className="flex flex-col">
            {text.signatures.length > 0 && (
                <div className="flex flex-col gap-1 px-3 py-2.5">
                    {text.signatures.map((block, index) => (
                        <Signature key={index} code={block.code} language={block.language} />
                    ))}
                </div>
            )}
            {text.markdown !== '' && (
                <div
                    className={`px-3 py-2.5 text-text-muted select-text [&_.chat-markdown]:text-xs ${text.signatures.length > 0 ? 'border-t border-border' : ''}`}
                >
                    <Markdown text={text.markdown} fileLinks={false} />
                </div>
            )}
            {definition !== null && (
                <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs">
                    <button type="button" className="text-accent hover:underline" onClick={() => language.goTo(definition)}>
                        {t('language.hover.definition')}
                    </button>
                    {place !== null && (
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
export function HoverCard({ language, problems, info }: { language: EditorLanguage; problems: readonly Problem[]; info: HoverInfo | null }) {
    return (
        <div className="flex w-max min-w-[280px] max-w-[min(520px,calc(100vw-16px))] flex-col divide-y divide-border">
            {info !== null && <InfoSection language={language} info={info} />}
            {problems.map((problem, index) => (
                <ProblemSection key={index} problem={problem} language={language} />
            ))}
        </div>
    );
}
