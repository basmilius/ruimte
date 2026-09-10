import { useRef, useState, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Copy, Scan } from 'lucide-react';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { selectAllWithin, selectionWithin } from '@/ui/selection';

/*
 * A block of text and the menu that belongs to it: Copy for what is selected inside it, Select all
 * for the whole of it, on Cmd+A as well. Anywhere text can be selected a right-click has to offer
 * to copy it, and the app draws every menu itself, so a surface without one of these offers
 * nothing at all.
 */
export function TextMenu({ children, ...rest }: ComponentProps<'div'>) {
    const host = useRef<HTMLDivElement>(null);
    // Read when the menu opens: a selection made after that is not the one the click was about.
    const [selection, setSelection] = useState('');

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'a' || !(event.metaKey || event.ctrlKey)) {
            return;
        }
        event.preventDefault();
        selectAllWithin(host.current);
    };

    return (
        <ContextMenu.Root onOpenChange={(open) => setSelection(open ? selectionWithin(host.current) : '')}>
            <ContextMenu.Trigger {...rest} ref={host} onKeyDown={onKeyDown}>
                {children}
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-[var(--z-popup)]">
                    <ContextMenu.Popup className="menu-popup">
                        <ContextMenu.Item className="menu-item" disabled={selection === ''} onClick={() => copyText(selection)}>
                            <Icon icon={Copy} size={14} /> Copy <kbd>⌘C</kbd>
                        </ContextMenu.Item>
                        <ContextMenu.Separator className={MENU_SEPARATOR} />
                        <ContextMenu.Item className="menu-item" onClick={() => selectAllWithin(host.current)}>
                            <Icon icon={Scan} size={14} /> Select all <kbd>⌘A</kbd>
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}
