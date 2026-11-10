import { ScrollArea, TextMenu } from '@adecore/ui';
import clsx from 'clsx';
import type { ComponentProps } from 'react';

/*
 * The scrolling body of a file renderer. The canvas app turns selection off on `body`, so a file has
 * to ask for it back; `TextMenu` is what makes Cmd+A take the file that is open and not every
 * selectable thing on the page, and what puts Copy behind a right-click in it. `className` and the
 * other props land on the element that scrolls.
 */
export function FileScroll({ className, children, ...rest }: Omit<ComponentProps<'div'>, 'ref'>) {
    return (
        <ScrollArea {...rest} axis="both" render={<TextMenu />} tabIndex={-1} className="grow" viewportClassName={clsx('outline-none select-text', className)}>
            {children}
        </ScrollArea>
    );
}
