import clsx from 'clsx';
import { RUIMTE_MARK_PATHS, RUIMTE_MARK_VIEW_BOX } from '@/ui/ruimte-mark-paths';

interface RuimteMarkProps {
    size?: number;
    className?: string;
}

/*
 * The symbol of Ruimte in one color, for a row that sits beside Lucide icons: `currentColor` lets it go
 * muted, accent or red with its row. The two shapes overlap, so in one color they read as one.
 */
export function RuimteMark({ size = 12, className }: RuimteMarkProps) {
    return (
        <svg aria-hidden viewBox={RUIMTE_MARK_VIEW_BOX} width={size} height={size} fill="currentColor" className={clsx('shrink-0', className)}>
            {RUIMTE_MARK_PATHS.map((path) => (
                <path key={path} d={path} />
            ))}
        </svg>
    );
}
