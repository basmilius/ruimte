import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Icon } from '@adecore/ui';
import { accentShades } from '@/canvas/accents';
import { FRAME } from '@/canvas/derived-card-look';

/*
 * A collapsed card, which is all header: a press opens it. A colored one is tinted as a colored node's
 * header is, and its icon shows the chevron to open it while the pointer is on the line.
 */
export function CardLine({
    icon,
    accent,
    label,
    onOpen,
    children
}: {
    icon: ReactNode;
    accent: string | undefined;
    /* Its accessible name, when what it draws does not say what opens. */
    label?: string;
    onOpen: () => void;
    children: ReactNode;
}) {
    const shades = accent === undefined ? null : accentShades(accent);
    return (
        <button
            type="button"
            aria-expanded={false}
            aria-label={label}
            className={clsx(
                FRAME,
                'group/header flex-row items-center gap-2 px-3 text-left text-sm text-text',
                shades === null ? 'bg-surface hover:bg-surface-raised' : 'bg-(--run-tint) hover:bg-(--run-hover)'
            )}
            style={
                shades === null ? undefined : ({ borderColor: shades.frameBorder, '--run-tint': shades.header, '--run-hover': shades.hover } as CSSProperties)
            }
            onClick={onOpen}
        >
            <span aria-hidden className="relative flex size-3.5 shrink-0 items-center justify-center text-text-muted">
                <span className="flex transition-opacity group-hover/header:opacity-0">{icon}</span>
                <Icon icon={ChevronRight} size={14} className="absolute opacity-0 transition-opacity group-hover/header:opacity-100" />
            </span>
            {children}
        </button>
    );
}
