import { Icon } from '@adecore/ui';
import clsx from 'clsx';
import { Package, type LucideIcon } from 'lucide-react';
import { inkOn } from '@/extensions/ink';

/*
 * A mask rather than an image, so any svg comes out in one ink: a `currentColor` in a file loaded as an
 * image would draw black, and a store of icons in their own colors would not read as one list.
 */
export function ExtensionGlyph({ url, size, className }: { url: string; size: number; className?: string }) {
    const mask = `url("${url}") center / contain no-repeat`;

    return (
        <span
            aria-hidden
            className={clsx('inline-block shrink-0 bg-current align-middle', className)}
            style={{ width: size, height: size, mask, WebkitMask: mask }}
        />
    );
}

/* An extension's mark: its `assets/icon.svg`, or a built-in's Lucide icon, on the `color` of its manifest, or a package on a plain ground. */
export function ExtensionTile({ icon, color, size }: { icon: string | LucideIcon | null | undefined; color: string | undefined; size: number }) {
    const glyph = Math.round(size * 0.625);

    return (
        <span
            aria-hidden
            className={clsx('inline-flex shrink-0 items-center justify-center', color === undefined && 'bg-surface-active text-text-muted')}
            style={{
                width: size,
                height: size,
                borderRadius: Math.round(size * 0.25),
                ...(color === undefined ? {} : { background: color, color: inkOn(color) })
            }}
        >
            {typeof icon === 'string' ? <ExtensionGlyph url={icon} size={glyph} /> : <Icon icon={icon ?? Package} size={glyph} />}
        </span>
    );
}
