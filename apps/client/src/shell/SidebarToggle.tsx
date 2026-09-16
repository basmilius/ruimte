import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { APP_SHORTCUTS } from '@/shell/shortcuts';

/* The toolbar keeps this control available when the sidebar is closed. */
export function SidebarToggle() {
    const open = useUi((s) => s.sidebarOpen);
    return (
        <Tooltip label={open ? 'Hide sidebar' : 'Show sidebar'} kbd={APP_SHORTCUTS.sidebar}>
            <button
                className="icon-btn shrink-0"
                aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
                /* Expanded rather than pressed: the icon already says which way it goes, and a
                   pressed toggle would sit filled for as long as the sidebar is open. */
                aria-expanded={open}
                aria-controls="app-sidebar"
                onClick={() => useUi.getState().toggleSidebar()}
            >
                <Icon icon={open ? PanelLeftClose : PanelLeft} size={16} />
            </button>
        </Tooltip>
    );
}
