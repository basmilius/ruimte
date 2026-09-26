import type { ComponentProps } from 'react';
import clsx from 'clsx';
import { TextMenu } from '@ruimte/ui/TextMenu';

/*
 * The scrolling body of a file renderer. The canvas app turns selection off on `body`, so a file has
 * to ask for it back; `TextMenu` is what makes Cmd+A take the file that is open and not every
 * selectable thing on the page, and what puts Copy behind a right-click in it.
 */
export function FileScroll({ className, children, ...rest }: ComponentProps<'div'>) {
    return (
        <TextMenu {...rest} tabIndex={-1} className={clsx('min-h-0 grow overflow-auto outline-none select-text', className)}>
            {children}
        </TextMenu>
    );
}
