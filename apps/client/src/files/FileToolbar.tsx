import { cameThroughPortal, IconButton, Separator, Menu, TextMenu, ContextMenu } from '@adecore/ui';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { fileInfoOf } from '@/extensions/file-info';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { FileMenuRowsContext, useFileActions, type FileActions } from '@/files/file-actions';
import { FileActionItems } from '@/files/FileActionItems';
import { FileMenuItems } from '@/files/FileMenuItems';
import { FILE_TOOLBAR } from '@/surface/panels/classes';
import { useFileToolbarSlot } from '@/surface/panels/file-toolbar-slot';

/*
 * The bar above every file renderer, one for all of them so a control keeps its place when the file
 * changes type. Where the surface carries a bar already (`file-toolbar-slot.ts`) the controls go up into
 * that one, and `leading` is dropped, since that surface already says where the file is.
 */
export function FileToolbar({ children, menu, leading }: { children?: ReactNode; menu?: ReactNode; leading?: ReactNode }) {
    const { host } = useFileToolbarSlot();
    const controls = (
        <>
            {children}
            <EditorSlot />
            {/* With no controls the menu is the only group there is, and a line would divide nothing. */}
            {children !== undefined && <Separator />}
            <FileMenu extra={menu} />
        </>
    );
    if (host !== null) {
        return createPortal(controls, host);
    }
    return (
        <FileContextMenu className={FILE_TOOLBAR}>
            {leading === undefined ? <span className="grow" /> : <div className="flex min-w-0 grow items-center">{leading}</div>}
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
        <IconButton
            icon={icon}
            size="sm"
            label={label}
            aria-pressed={active}
            aria-disabled={disabled}
            onClick={() => {
                if (!disabled) {
                    onClick();
                }
            }}
        />
    );
}

/*
 * Everything the file can be asked, at the end of the bar; a node or a view has no tab to pin or close,
 * so it gets only the items about the file. `extra` holds the renderer's rarer settings above them.
 */
function FileMenu({ extra }: { extra?: ReactNode }) {
    const { t } = useTranslation('common');
    const rows = useMenuRows();

    if (rows === null && extra === undefined) {
        return null;
    }

    return (
        <Menu.Root>
            <IconButton icon={MoreHorizontal} size="sm" label={t('action.more')} render={<Menu.Trigger />} />
            <Menu.Popup align="end">
                {extra}
                {extra !== undefined && rows !== null && <Menu.Separator />}
                {rows}
            </Menu.Popup>
        </Menu.Root>
    );
}

function useMenuRows(): ReactNode {
    const actions = useFileActions();
    const standIn = useContext(FileMenuRowsContext);
    if (standIn !== null && standIn !== undefined) {
        return standIn;
    }
    return actions ? <FileMenuRows actions={actions} /> : null;
}

function EditorSlot() {
    const actions = useFileActions();

    return actions ? <SlotRow place="editorToolbar" context={{ file: fileInfoOf(actions.path) }} /> : null;
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
    const rows = useMenuRows();

    if (rows === null) {
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
            <ContextMenu.Popup>{rows}</ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

/* Text about the file rather than the file itself, a reason it will not show: Copy and Select all for the words, the file's items under them. */
export function FileTextMenu({ className, children }: { className?: string; children: ReactNode }) {
    const rows = useMenuRows();
    return (
        <TextMenu className={className} items={rows ?? undefined}>
            {children}
        </TextMenu>
    );
}
