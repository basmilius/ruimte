import { useTranslation } from 'react-i18next';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { APP_SHORTCUTS } from '@/shell/shortcuts';

/* The toolbar keeps this control available when the sidebar is closed. */
export function SidebarToggle() {
    const { t } = useTranslation('shell');
    const open = useUi((s) => s.sidebarOpen);
    const label = open ? t('sidebar.hide') : t('sidebar.show');
    return (
        <Tooltip label={label} kbd={APP_SHORTCUTS.sidebar}>
            <button
                className="icon-btn shrink-0"
                aria-label={label}
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
