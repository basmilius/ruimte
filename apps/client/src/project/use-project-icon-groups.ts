import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import type { IconPickerGroup } from '@adecore/ui';
import { PROJECT_ICON_GROUPS } from '@/project/project-icons';

/* The icon groups as the picker takes them, each under its label in the reader's language. */
export function useProjectIconGroups(): readonly IconPickerGroup[] {
    const { t } = useTranslation('common');
    return useMemo(
        () =>
            PROJECT_ICON_GROUPS.map((group) => ({
                id: group.id,
                label: t(`icon.group.${group.id}`),
                icons: group.icons as Readonly<Record<string, LucideIcon>>
            })),
        [t]
    );
}
