import { useTranslation } from 'react-i18next';
import { Minimize2 } from 'lucide-react';
import { formatTokens } from '@/format/number';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/*
 * The offer at the top of the composer, for a chat that lay still long enough that the next message
 * pays for the whole thread again. It takes no keys and blocks nothing: typing and sending keeps the
 * full history, which is what a person who ignores this does.
 */
export function ResumeCompactionDock({ tokens, onCompact, onDismiss }: { tokens: number; onCompact(): void; onDismiss(): void }) {
    const { t } = useTranslation('chat');
    return (
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <Icon icon={Minimize2} size={16} className="shrink-0 text-text-faint" />
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{t('resumeCompaction.title')}</span>
                <span className="truncate text-xs tabular-nums text-text-faint">{t('resumeCompaction.carried', { tokens: formatTokens(tokens) })}</span>
            </span>
            <Button size="sm" onClick={onDismiss}>
                {t('resumeCompaction.keep')}
            </Button>
            <Button size="sm" variant="primary" onClick={onCompact}>
                {t('resumeCompaction.compact')}
            </Button>
        </div>
    );
}
