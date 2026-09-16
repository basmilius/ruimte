import clsx from 'clsx';
import icon64 from '@/ui/app-icon/app-icon-64.png';
import icon128 from '@/ui/app-icon/app-icon-128.png';
import icon256 from '@/ui/app-icon/app-icon-256.png';

/* Copies of `assets/AppIcon.export`, so the browser picks the one that is sharp at the size and density it draws. */
const SOURCES = `${icon64} 64w, ${icon128} 128w, ${icon256} 256w`;

interface BrandSymbolProps {
    size?: number;
    className?: string;
}

/* The app icon on its own, sized in whole pixels. It is decorative wherever it appears: the word next
   to it, or the label of the pane it sits in, is what a screen reader reads. */
export function BrandSymbol({ size = 24, className }: BrandSymbolProps) {
    return (
        <img src={icon128} srcSet={SOURCES} sizes={`${size}px`} width={size} height={size} alt="" draggable={false} className={clsx('shrink-0', className)} />
    );
}

interface BrandProps {
    size?: number;
    className?: string;
}

/* Symbol plus wordmark. The word is Geist at 600, the only place in the client that leaves the
   interface font. */
export function Brand({ size = 24, className }: BrandProps) {
    return (
        <span className={clsx('inline-flex items-center gap-2', className)}>
            <BrandSymbol size={size} />
            <span className="font-brand text-sm font-semibold text-text">Ruimte</span>
        </span>
    );
}
