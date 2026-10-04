import { useTranslation } from 'react-i18next';
import { CircleX, GitBranch, TriangleAlert } from 'lucide-react';
import type { Editor, EditorBlock, EditorIndentation } from '@ruimte/smart-editor';
import { ErrorBoundary, Icon, Tooltip } from '@basmilius/desktop-ui';
import { formatNumber } from '@basmilius/desktop-ui/format';
import type { EditorLanguage } from '@/language/editor-language';
import { LanguageStatusItem } from '@/language/LanguageStatusItem';
import { useProblemCounts } from '@/language/use-problem-counts';
import { encodingLabelOf, languageNameOf, symbolBadgeOf } from '@/shell/panels/status-bar-model';
import { useEditorCaret } from '@/shell/panels/use-editor-caret';
import { useFileBranch } from '@/shell/panels/use-file-branch';

const ITEM = 'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5';

export interface EditorStatusBarProps {
    editor: Editor;
    /* Null where no language server serves the file. */
    language: EditorLanguage | null;
    /* Absolute on the daemon's machine. */
    path: string;
    /* The highlighter id the file read as; undefined for plain text. */
    languageId: string | undefined;
    indentation: EditorIndentation;
    /* As the file read says it, such as `utf-8`. */
    encoding: string;
    lineEnding: string;
    /* The named blocks around the caret, outermost first. */
    scope: readonly EditorBlock[];
}

/*
 * The strip under the editor, the way a code editor has one: where the file is (branch, problems,
 * the symbol the caret is in) on the left and what it is on the right (position, indentation, encoding,
 * line ending, language and the language servers).
 */
export function EditorStatusBar({ editor, language, path, languageId, indentation, encoding, lineEnding, scope }: EditorStatusBarProps) {
    const { t } = useTranslation('panels');
    const caret = useEditorCaret(editor);
    const counts = useProblemCounts(language);
    const branch = useFileBranch(path);
    const symbol = scope.at(-1);
    const languageName = languageNameOf(languageId);

    return (
        <div
            className="relative flex h-[26px] shrink-0 items-center gap-1.5 border-t border-border bg-surface px-2 text-xs whitespace-nowrap text-text-muted select-none"
            data-editor-status-bar
        >
            {branch !== null && (
                <Tooltip label={t('statusBar.branch')}>
                    <span className={ITEM}>
                        <Icon icon={GitBranch} size={12} />
                        {branch}
                    </span>
                </Tooltip>
            )}
            {language !== null && (
                <Tooltip label={t('statusBar.problems')}>
                    <button type="button" className={`${ITEM} hover:bg-surface-hover hover:text-text`} onClick={() => void language.diagnostics.goToFirst()}>
                        <Icon icon={CircleX} size={12} className={counts.error > 0 ? 'text-status-error' : 'text-text-faint'} />
                        <span aria-label={t('statusBar.errorsCount', { count: counts.error, formatted: formatNumber(counts.error) })}>
                            {formatNumber(counts.error)}
                        </span>
                        <Icon icon={TriangleAlert} size={12} className={counts.warning > 0 ? 'text-status-needs-you' : 'text-text-faint'} />
                        <span aria-label={t('statusBar.warningsCount', { count: counts.warning, formatted: formatNumber(counts.warning) })}>
                            {formatNumber(counts.warning)}
                        </span>
                    </button>
                </Tooltip>
            )}
            {symbol?.name !== undefined && symbol.name !== '' && (
                <Tooltip label={t('statusBar.symbol')}>
                    <span className={`${ITEM} min-w-0`}>
                        {symbolBadgeOf(symbol.kind) !== '' && (
                            <span className="grid size-4 shrink-0 place-items-center rounded-sm bg-accent-soft font-mono text-xs font-semibold text-accent">
                                {symbolBadgeOf(symbol.kind)}
                            </span>
                        )}
                        <span className="truncate">{symbol.name}</span>
                    </span>
                </Tooltip>
            )}
            <span className="grow" />
            <span className={ITEM}>{t('statusBar.position', { line: formatNumber(caret.line + 1), column: formatNumber(caret.character + 1) })}</span>
            <span className={ITEM}>
                {indentation.insertSpaces
                    ? t('statusBar.spaces', { count: formatNumber(indentation.tabSize) })
                    : t('statusBar.tabs', { count: formatNumber(indentation.tabSize) })}
            </span>
            <span className={ITEM}>{encodingLabelOf(encoding)}</span>
            <span className={ITEM}>{lineEnding}</span>
            {language !== null ? (
                <ErrorBoundary label={t('file.edit.failed')} resetKeys={[language]}>
                    <LanguageStatusItem language={language} name={languageName ?? ''} />
                </ErrorBoundary>
            ) : (
                languageName !== null && <span className={ITEM}>{languageName}</span>
            )}
        </div>
    );
}
