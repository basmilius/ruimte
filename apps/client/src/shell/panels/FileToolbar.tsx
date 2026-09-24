import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { useFileActions, type FileActions } from '@/shell/panels/file-actions';
import { FileMenuItems } from '@/shell/panels/FileMenuItems';
import { cameThroughPortal } from '@/ui/floating';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
import { MenuPopup } from '@/ui/MenuPopup';
import { TextMenu } from '@/ui/TextMenu';

/*
 * The bar above every file renderer: the controls that change how the file is drawn, at its right.
 * One component for all the renderers, so a control keeps its place when the open file changes
 * type, and the menu at its end is the same everywhere for the same reason. Where the surface
 * carries a bar already (`file-toolbar-slot.ts`) the controls go up into that one instead, since a
 * second row under it would say the same thing twice.
 */
export function FileToolbar({ children }: { children?: ReactNode }) {
    const { host } = useFileToolbarSlot();
    const controls = (
        <>
            {children}
            {/* With no controls the menu is the only group there is, and a line would divide nothing. */}
            {children !== undefined && <Separator />}
            <FileMenu />
        </>
    );
    if (host !== null) {
        return createPortal(controls, host);
    }
    return (
        <FileContextMenu className={FILE_TOOLBAR}>
            <span className="grow" />
            {controls}
        </FileContextMenu>
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

/*
 * Everything the file can be asked, in one menu at the end of the bar. On a tab the items are the
 * ones a right click on it offers as well; a node and a view of its own have no tab to pin or
 * close, so they get the half that is about the file. The file comes from `FileBody` through
 * `useFileActions`, so no renderer has to hand it over.
 */
function FileMenu() {
    const { t } = useTranslation('common');
    const actions = useFileActions();

    if (!actions) {
        return null;
    }

    return (
        <Menu.Root>
            <Tooltip label={t('action.more')} name>
                <Menu.Trigger className="icon-btn h-7 w-7">
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.Trigger>
            </Tooltip>
            <MenuPopup align="end">
                <FileMenuRows actions={actions} />
            </MenuPopup>
        </Menu.Root>
    );
}

function FileMenuRows({ actions }: { actions: FileActions }) {
    return actions.tabKey === undefined ? (
        <FileActionItems path={actions.path} on={actions.on} onRefresh={actions.refresh} />
    ) : (
        <FileMenuItems tabKey={actions.tabKey} onRefresh={actions.refresh} />
    );
}

/*
 * The bar's menu behind a right-click on a file that has no text to copy, an image or a video, and
 * on the bar itself, so the click there offers what the file can be asked instead of nothing.
 */
export function FileContextMenu({ className, children }: { className?: string; children: ReactNode }) {
    const actions = useFileActions();

    if (!actions) {
        return <div className={className}>{children}</div>;
    }

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                className={className}
                onContextMenu={(event) => {
                    // The overflow menu is a child here as well, and a right-click in it is not one on the file.
                    if (cameThroughPortal(event)) {
                        event.preventBaseUIHandler();
                    }
                }}
            >
                {children}
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        <FileMenuRows actions={actions} />
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

/* Text about the file rather than the file itself, a reason it will not show: Copy and Select all for the words, the file's items under them. */
export function FileTextMenu({ className, children }: { className?: string; children: ReactNode }) {
    const actions = useFileActions();
    return (
        <TextMenu className={className} items={actions ? <FileMenuRows actions={actions} /> : undefined}>
            {children}
        </TextMenu>
    );
}
