import { IconButton } from '@adecore/ui';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKeyOf } from '@/shell/shortcut-overrides';
import { useUi } from '@/state/ui';

/* The toolbar keeps this control available when the sidebar is closed. */
export function SidebarToggle() {
    const { t } = useTranslation('shell');
    const open = useUi((s) => s.sidebarOpen);
    const label = open ? t('sidebar.hide') : t('sidebar.show');
    const key = useKeyOf('sidebar');
    return (
        <IconButton
            icon={open ? PanelLeftClose : PanelLeft}
            label={label}
            kbd={key}
            className="shrink-0"
            /* Expanded rather than pressed: the icon already says which way it goes, and a
               pressed toggle would sit filled for as long as the sidebar is open. */
            aria-expanded={open}
            aria-controls="app-sidebar"
            onClick={() => useUi.getState().toggleSidebar()}
        />
    );
}
