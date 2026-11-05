import type { IconPickerGroup } from '@adecore/ui';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROJECT_ICON_GROUPS } from '@/surface/project-icons';

/* The icon groups as the picker takes them, each under its label in the reader's language. */
export function useProjectIconGroups(): readonly IconPickerGroup[] {
    const { t } = useTranslation('common');
    return PROJECT_ICON_GROUPS.map((group) => ({
        id: group.id,
        label: t(`icon.group.${group.id}`),
        icons: group.icons as Readonly<Record<string, LucideIcon>>
    }));
}
