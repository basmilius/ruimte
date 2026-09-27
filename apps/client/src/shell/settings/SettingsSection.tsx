import { Laptop, MonitorSmartphone, Server, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@basmilius/react-ui';
import { SettingsSection as Section, type SettingsSectionProps as SectionProps } from '@basmilius/react-ui/settings';

/* Where a setting applies: this window's client, the computer it runs on, or the machine that acts on it. */
type SettingsScope = 'client' | 'computer' | 'machine';

const SCOPE_ICONS: Record<SettingsScope, LucideIcon> = { client: MonitorSmartphone, computer: Laptop, machine: Server };

function ScopeTag({ scope }: { scope: SettingsScope }) {
    const { t } = useTranslation('settings');
    return (
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-surface-hover px-2 text-xs text-text-muted">
            <Icon icon={SCOPE_ICONS[scope]} size={12} />
            {t(`scope.${scope}`)}
        </span>
    );
}

type SettingsSectionProps = Omit<SectionProps, 'tag'> & { scope?: SettingsScope };

/* The card of @basmilius/react-ui with the tag that says where its settings apply. */
export function SettingsSection({ scope, ...props }: SettingsSectionProps) {
    return <Section {...props} tag={scope && <ScopeTag scope={scope} />} />;
}
