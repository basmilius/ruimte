import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { BellRing } from 'lucide-react';
import type { ProjectSettingsSectionDefinition } from '@/registry/project-settings-sections';

function words(key: string): () => string {
    return () => i18next.t(`shell:projectSettings.${key}`);
}

export const SOUND_PROJECT_SETTINGS_SECTION: ProjectSettingsSectionDefinition = {
    id: 'sounds',
    icon: BellRing,
    label: words('sounds'),
    description: words('soundsNote'),
    pane: lazyNamed(() => import('@/attention/ProjectSoundsPane'), 'ProjectSoundsPane'),
    rows: [
        { id: 'sounds.pack', label: words('soundsPack') },
        { id: 'sounds.silent', label: words('soundsSilent') }
    ]
};
