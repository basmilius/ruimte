import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { formatShortcut, Icon, shortcut } from '@adecore/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { isApplePlatform } from '@/desktop/bridge';

const TAB = shortcut('Tab');
const ESCAPE = shortcut('Escape');

/* What stands after the first line of a ghost suggestion, or after the line the model is still writing it for: who wrote it and which keys take it. */
export function GhostHint({ phase }: { phase: 'progress' | 'ready' }) {
    const { t } = useTranslation('panels');
    const apple = isApplePlatform();
    const keys = (name: string, chord: typeof TAB): string => `${formatShortcut(chord, apple)} ${name}`;
    return (
        <span className="inline-flex h-5 items-center gap-2 font-sans text-xs whitespace-nowrap text-text-faint not-italic">
            <span className="flex h-[18px] items-center gap-1.25 rounded-sm bg-surface-sunken px-1.75 dark:bg-surface-active">
                <Icon icon={Cpu} size={12} className="shrink-0" />
                {t('language.ghost.onDevice')}
            </span>
            {phase === 'ready'
                ? [keys(t('language.ghost.accept'), TAB), keys(t('language.ghost.next'), CANVAS_SHORTCUTS.acceptGhostWord), formatShortcut(ESCAPE, apple)].join(
                      ' · '
                  )
                : `${t('language.ghost.thinking')} · ${formatShortcut(ESCAPE, apple)}`}
        </span>
    );
}
