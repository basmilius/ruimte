import { CHAT_SETTINGS_SECTION } from '@/chat/settings-section';
import { EXTENSION_SETTINGS_SECTION } from '@/extensions/settings-section';
import { MACHINE_SETTINGS_SECTION } from '@/machine-ui/settings-section';
import { PROJECT_SETTINGS_SECTIONS } from '@/project/settings-sections';
import { PROVIDER_SETTINGS_SECTION } from '@/providers/settings-section';
import { projectSettingsSectionRegistry } from '@/registry/project-settings-sections';
import { settingsSectionRegistry } from '@/registry/settings-sections';
import { AGENT_SETTINGS_SECTION } from '@/settings/agents-section';
import { APP_SETTINGS_SECTIONS } from '@/settings/app-sections';
import { TUNNEL_SETTINGS_SECTION } from '@/tunnels/settings-section';
import { USAGE_SETTINGS_SECTION } from '@/usage/settings-section';
import { VOICE_SETTINGS_SECTION } from '@/voice/settings-section';

/* The settings sections, in the order of the navigation: a section sits after the ones its group registered before it. */
export function installSettingsSections(): void {
    settingsSectionRegistry.add(
        ...APP_SETTINGS_SECTIONS,
        EXTENSION_SETTINGS_SECTION,
        PROVIDER_SETTINGS_SECTION,
        CHAT_SETTINGS_SECTION,
        AGENT_SETTINGS_SECTION,
        TUNNEL_SETTINGS_SECTION,
        VOICE_SETTINGS_SECTION,
        USAGE_SETTINGS_SECTION,
        MACHINE_SETTINGS_SECTION
    );
    projectSettingsSectionRegistry.add(...PROJECT_SETTINGS_SECTIONS);
}
