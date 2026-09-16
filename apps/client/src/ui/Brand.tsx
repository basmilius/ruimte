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
    className?: string;
}

export function Brand({ className }: BrandProps) {
    return <span className={clsx('inline-flex h-6 items-center font-brand text-xs font-semibold tracking-[0.2em] text-text-faint', className)}>RUIMTE</span>;
}

/* The start screen's welcome: the icon, the wordmark at the largest size the theme has, and the tagline under it. */
export function BrandIntro({ className }: { className?: string }) {
    return (
        <header className={clsx('flex flex-col items-center gap-4 py-6 text-center', className)}>
            <BrandSymbol size={88} />
            <div className="flex flex-col items-center gap-1">
                <h1 className="font-brand text-4xl font-semibold text-text">Ruimte</h1>
                <p className="text-base text-text-muted">Space for AI Engineering.</p>
            </div>
        </header>
    );
}
