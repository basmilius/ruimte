import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCommitHorizontal, User, Users } from 'lucide-react';
import { Button, Icon, Popover, Separator, Tooltip, useNow } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { relativeTime } from '@/shell/panels/commit-log';
import type { EditorLanguage } from './editor-language';
import type { AuthorsView } from './popups';

const MINUTE_MS = 60_000;

/*
 * Who wrote a declaration, by lines, and the newest commit that touched it. It opens beside the entry that
 * was pressed and closes on Escape or a press anywhere else; Escape hands the keyboard back to the editor.
 */
export function CodeAuthorsCard({ language, view }: { language: EditorLanguage; view: AuthorsView }) {
    const { t } = useTranslation('panels');
    const now = Math.floor(useNow(MINUTE_MS) / 1000);
    const { authors, uncommittedLines, latest } = view.authorship;
    const anchor = useMemo(() => {
        const { left, top, right, bottom } = view.anchor;
        return { getBoundingClientRect: () => new DOMRect(left, top, right - left, bottom - top) };
    }, [view.anchor]);

    return (
        <Popover.Root open onOpenChange={(open, details) => !open && language.codeVision.closeAuthors(details.reason === 'escape-key')}>
            <Popover.Popup anchor={anchor} side="bottom" align="start" sideOffset={4} className="flex w-72 flex-col gap-2 p-3 text-xs">
                <Popover.Title className="flex items-center gap-1.5 font-medium text-text">
                    <Icon icon={authors.length > 1 ? Users : User} size={14} className="shrink-0 text-text-muted" />
                    <span className="min-w-0 truncate">{view.name}</span>
                </Popover.Title>
                <ul className="flex flex-col gap-1">
                    {authors.map((author) => (
                        <li key={author.name} className="flex items-baseline gap-2">
                            <Tooltip label={author.email}>
                                <span className="min-w-0 grow truncate text-text">{author.name}</span>
                            </Tooltip>
                            <span className="shrink-0 text-text-muted">
                                {t('language.codeVision.lines', { count: author.lines, formatted: formatNumber(author.lines) })}
                            </span>
                        </li>
                    ))}
                    {uncommittedLines > 0 && (
                        <li className="flex items-baseline gap-2 text-text-muted">
                            <span className="min-w-0 grow truncate">{t('language.codeVision.uncommitted')}</span>
                            <span className="shrink-0">
                                {t('language.codeVision.lines', { count: uncommittedLines, formatted: formatNumber(uncommittedLines) })}
                            </span>
                        </li>
                    )}
                </ul>
                {latest !== null && (
                    <>
                        <Separator />
                        <div className="flex flex-col gap-1">
                            <span className="text-text-muted">{t('language.codeVision.latest')}</span>
                            <span className="text-text select-text">{latest.summary}</span>
                            <span className="flex items-center gap-1.5 text-text-muted">
                                <span className="font-mono select-text">{latest.shortHash}</span>
                                <span className="min-w-0 truncate">{latest.author}</span>
                                <span className="shrink-0">{relativeTime(latest.at, now)}</span>
                            </span>
                        </div>
                        {view.openCommit !== null && (
                            <div className="flex justify-end">
                                <Popover.Close
                                    render={
                                        <Button size="xs" variant="secondary" onClick={view.openCommit}>
                                            <Icon icon={GitCommitHorizontal} size={14} />
                                            {t('language.codeVision.showCommit')}
                                        </Button>
                                    }
                                />
                            </div>
                        )}
                    </>
                )}
            </Popover.Popup>
        </Popover.Root>
    );
}
