import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleX, Info, Sparkles, TriangleAlert } from 'lucide-react';
import { FileIcon, Icon, Tooltip } from '@adecore/ui';
import { lineRangeLabel } from '@/chat/selection-to-chat';
import type { EditorLanguage as RuimteEditorLanguage } from '@/language/ruimte-editor-language';

type EditorLanguage = Pick<RuimteEditorLanguage, 'editor' | 'inlineEdit'>;
import { basenameOf } from '@/shell/panels/files-tree';
import { InlineAgentPicker } from './InlineAgentPicker';
import type { InlineEditFeature, InlinePrompt } from './inline-edit';
import { problemChips, problemDetail, problemLabel } from './inline-edit-layout';
import type { InlineProblem } from './inline-edit-model';

const SEVERITY_ICONS = { error: CircleX, warning: TriangleAlert, info: Info, hint: Info } as const;
const SEVERITY_TONES = { error: 'text-status-error', warning: 'text-status-needs-you', info: 'text-text-muted', hint: 'text-text-muted' } as const;

const CHIP_CLASS = 'flex h-6 min-w-0 shrink items-center gap-1.5 rounded-md bg-surface-hover px-2 text-xs whitespace-nowrap text-text';

/* One problem on the lines: cut to a sensible length, with the whole message in its tooltip. */
function ProblemChip({ problem }: { problem: InlineProblem }) {
    const { t } = useTranslation('inline-edit');
    return (
        <Tooltip label={problemDetail(problem)} side="bottom">
            <span className={CHIP_CLASS} aria-label={t('prompt.problems')}>
                <Icon icon={SEVERITY_ICONS[problem.severity]} size={12} className={`shrink-0 ${SEVERITY_TONES[problem.severity]}`} />
                <span className="truncate">{problemLabel(problem)}</span>
            </span>
        </Tooltip>
    );
}

function Problems({ problems }: { problems: readonly InlineProblem[] }) {
    const { shown, hidden } = problemChips(problems);
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {shown.map((problem, index) => (
                <ProblemChip key={`${problem.line}:${index}`} problem={problem} />
            ))}
            {hidden.length > 0 && (
                <Tooltip
                    label={
                        <span className="flex flex-col">
                            {hidden.map((problem, index) => (
                                <span key={`${problem.line}:${index}`}>{problemLabel(problem, 72)}</span>
                            ))}
                        </span>
                    }
                    side="bottom"
                >
                    <span className="text-xs text-text-faint">+{hidden.length}</span>
                </Tooltip>
            )}
        </div>
    );
}

/*
 * The question over the selected lines, in the row the editor makes for it: what to change, which
 * agent answers, the lines and the problems on them that go along, and the keys. Each part has its own
 * place and the row wraps instead of overlapping when the editor is narrow.
 */
export function InlinePromptCard({ feature, language, prompt }: { feature: InlineEditFeature; language: EditorLanguage; prompt: InlinePrompt }) {
    const { t } = useTranslation('inline-edit');
    const input = useRef<HTMLInputElement>(null);
    const path = basenameOf(language.inlineEdit.path);

    // The editor's own focus handling is done by the time this runs, so the keys go to the question and stay there.
    useEffect(() => {
        input.current?.focus();
    }, []);

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            feature.run();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            feature.cancel();
        }
    }

    return (
        <div data-inline-edit-card className="pt-1.5 pr-4 pb-2 pl-(--se-gutter-width)">
            <div className="flex w-full max-w-[660px] flex-col gap-2.5 rounded-[10px] border border-border bg-surface-raised px-3 py-2.5 text-text shadow-(--float-shadow)">
                <div className="flex items-start gap-2.5">
                    <Icon icon={Sparkles} size={14} className="mt-0.5 shrink-0 text-text-faint" />
                    <input
                        ref={input}
                        aria-label={t('prompt.input')}
                        placeholder={t('prompt.input')}
                        spellCheck={false}
                        autoComplete="off"
                        value={prompt.instruction}
                        className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                        onChange={(event) => feature.setInstruction(event.target.value)}
                        onKeyDown={onKeyDown}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
                    <InlineAgentPicker agent={prompt} onChange={(agent) => feature.setAgent(agent.provider, agent.model, agent.account)} finalFocus={input} />
                    <span className={CHIP_CLASS} aria-label={t('prompt.lines')}>
                        <FileIcon path={language.inlineEdit.path} size={12} />
                        <span className="truncate">{lineRangeLabel(path, prompt.span.startLine, prompt.span.endLine)}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-text-faint">
                        ↵ {t('prompt.run')} · Esc {t('prompt.cancel')}
                    </span>
                </div>
                {prompt.problems.length > 0 && <Problems problems={prompt.problems} />}
            </div>
        </div>
    );
}
