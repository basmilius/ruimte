import type { ReactNode } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { MoreHorizontal, WrapText, type LucideIcon } from 'lucide-react';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { useFileActions } from '@/shell/panels/file-actions';
import { FileMenuItems } from '@/shell/panels/FileMenuItems';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The bar above every file renderer: the controls that change how the file is drawn, at its right.
 * One component for all three renderers, so a control keeps its place when the open file changes
 * type, and the menu at its end is the same everywhere for the same reason.
 */
export function FileToolbar({ children }: { children?: ReactNode }) {
    return (
        <div className={FILE_TOOLBAR}>
            <span className="grow" />
            {children}
            {/* With no controls the menu is the only group there is, and a line would divide nothing. */}
            {children !== undefined && <Separator />}
            <FileMenu />
        </div>
    );
}

interface FileToolbarToggleProps {
    icon: LucideIcon;
    /* Also the button's accessible name, since the glyph carries no words of its own. */
    label: string;
    active: boolean;
    /* `aria-disabled` rather than `disabled`: a disabled button swallows the pointer, and with it the
       tooltip that says why the control cannot be used right now. */
    disabled?: boolean;
    onClick: () => void;
}

/* One control in the bar. `aria-pressed` is both the state a screen reader reads and what draws the
   pressed gray key, the same style `data-active` gets in `styles.css`. */
export function FileToolbarToggle({ icon, label, active, disabled = false, onClick }: FileToolbarToggleProps) {
    return (
        <Tooltip label={label} name>
            <button
                className="icon-btn h-7 w-7 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
                aria-pressed={active}
                aria-disabled={disabled}
                onClick={() => {
                    if (!disabled) {
                        onClick();
                    }
                }}
            >
                <Icon icon={icon} size={14} />
            </button>
        </Tooltip>
    );
}

/* The code view's wrap control as every other view draws it: there, so the switch beside it keeps its
   place, and inert, because there are no lines of source to wrap. */
export function DisabledWrapToggle() {
    return <FileToolbarToggle icon={WrapText} label="Wrap long lines (source view only)" active={false} disabled onClick={() => undefined} />;
}

/*
 * Everything the open file can be asked, in one menu at the end of the bar. The items are the ones
 * a right click on the tab offers as well; the file comes from the viewer through `useFileActions`,
 * so no renderer has to hand it over.
 */
function FileMenu() {
    const actions = useFileActions();

    if (!actions) {
        return null;
    }

    return (
        <Menu.Root>
            <Tooltip label="More" name>
                <Menu.Trigger className="icon-btn h-7 w-7">
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-[var(--z-popup)]" side="bottom" align="end" sideOffset={6}>
                    <Menu.Popup className="menu-popup">
                        <FileMenuItems tabKey={actions.key} onRefresh={actions.refresh} />
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}
