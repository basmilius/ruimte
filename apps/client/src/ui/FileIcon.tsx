import clsx from 'clsx';
import { fileIconFor, mountFileIconSprite } from '@/ui/file-icon';

// Before the first icon renders, so a `<use>` never points at a symbol that is not in the document.
mountFileIconSprite();

interface FileIconProps {
    /* Absolute or relative; only the last segment decides which icon this is. */
    path: string;
    size?: number;
    className?: string;
}

/*
 * The icon a file gets in the tree, drawn anywhere else the same file's name shows up. It is the
 * one place the app steps outside Lucide. The glyphs are the `@pierre/trees` set, and their colors
 * are the set's own, because a TypeScript blue or a Vue green is the mark of the file type, not a
 * theme choice. Decorative like every other icon here, so the name beside it does the reading.
 */
export function FileIcon({ path, size = 16, className }: FileIconProps) {
    const { symbol, hue } = fileIconFor(path);
    return (
        <svg className={clsx('file-icon', className)} data-hue={hue} width={size} height={size} viewBox="0 0 16 16" aria-hidden>
            <use href={`#${symbol}`} />
        </svg>
    );
}
