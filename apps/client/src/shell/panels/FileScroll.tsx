import { useRef, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import clsx from 'clsx';

/*
 * The scrolling body of a file renderer. The canvas app turns selection off on `body`, so a file has
 * to ask for it back; Cmd+A takes the file that is open and not every selectable thing on the page,
 * which is what the focus and the handler here are for.
 */
export function FileScroll({ className, children, ...rest }: ComponentProps<'div'>) {
    const ref = useRef<HTMLDivElement>(null);

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'a' || !(event.metaKey || event.ctrlKey) || ref.current === null) {
            return;
        }
        event.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(ref.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    };

    return (
        <div {...rest} ref={ref} tabIndex={-1} className={clsx('min-h-0 grow overflow-auto outline-none select-text', className)} onKeyDown={onKeyDown}>
            {children}
        </div>
    );
}
