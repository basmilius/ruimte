import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Check } from 'lucide-react';
import { bothLines, sideLines, type MergeBlock, type MergeSide } from '@ruimte/merge';
import { Icon } from '@/ui/Icon';

interface SideProps {
    readonly label: string;
    readonly lines: readonly string[];
    readonly take: string;
    readonly disabled: boolean;
    onTake(): void;
}

/* One side of the conflict on screen: what that side holds, and the button that makes it the answer. */
function Side({ label, lines, take, disabled, onTake }: SideProps) {
    const { t } = useTranslation('conflicts');
    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
                <span className="truncate text-xs font-medium text-text-muted">{label}</span>
                <button
                    className="ml-auto h-6 shrink-0 rounded-md px-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
                    disabled={disabled}
                    onClick={onTake}
                >
                    {take}
                </button>
            </div>
            <div className="min-h-0 grow overflow-auto">
                {lines.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-text-faint">{t('side.nothing')}</p>
                ) : (
                    <pre className="px-2 py-1 font-mono text-code leading-(--text-code--line-height) text-text">{lines.join('\n')}</pre>
                )}
            </div>
        </div>
    );
}

interface Props {
    readonly block: MergeBlock | null;
    readonly ours: string;
    readonly theirs: string;
    readonly settled: boolean;
    onTake(side: MergeSide): void;
    onBoth(first: MergeSide): void;
}

/*
 * The two sides of the conflict a person is on, under the merged file. Only the block in hand is
 * drawn: the whole of both files next to each other says less than the stretch that disagrees, and
 * the file itself is right above with the answer already in it.
 */
export function ConflictSides({ block, ours, theirs, settled, onTake, onBoth }: Props) {
    const { t } = useTranslation('conflicts');
    if (block === null) {
        return (
            <div className="grid h-full place-items-center px-4 text-center text-xs text-text-faint">
                <p>{t('side.none')}</p>
            </div>
        );
    }
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 grow divide-x divide-border">
                <Side label={ours} lines={sideLines(block, 'ours')} take={t('side.take')} disabled={false} onTake={() => onTake('ours')} />
                <Side label={theirs} lines={sideLines(block, 'theirs')} take={t('side.take')} disabled={false} onTake={() => onTake('theirs')} />
            </div>
            <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-2">
                {settled && (
                    <span className="flex items-center gap-1 text-xs text-status-idle">
                        <Icon icon={Check} size={12} />
                        {t('side.settled')}
                    </span>
                )}
                <span className="grow" />
                <button
                    className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
                    disabled={bothLines(block, 'ours').length === 0}
                    onClick={() => onBoth('ours')}
                >
                    <Icon icon={ArrowLeftRight} size={12} />
                    {t('side.bothOurs', { ours, theirs })}
                </button>
                <button
                    className="h-6 rounded-md px-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
                    disabled={bothLines(block, 'theirs').length === 0}
                    onClick={() => onBoth('theirs')}
                >
                    {t('side.bothTheirs', { ours, theirs })}
                </button>
            </div>
        </div>
    );
}
