import { Icon, Select, isApplePlatform } from '@adecore/ui';
import { SettingsSection as Section, type SettingsSectionProps as SectionProps } from '@adecore/ui/settings';
import { Laptop, Server, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop } from '@/desktop/bridge';
import { useListedMachines } from '@/machines/machine-list';
import { usePickedMachine, usePickedMachineState } from '@/machines/picked-machine';
import { useEndpointId } from '@/state/current-endpoint';
import { useEndpoints } from '@/state/endpoints';

/*
 * Where a setting applies when it is not this device, which goes without a tag: the computer this
 * window runs on, or a machine, named.
 */
type SettingsScope = 'computer' | 'machine';

const TAG = 'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-surface-hover px-2 text-xs text-text-muted';

function computerWords(): 'computerMac' | 'computerPc' | 'computer' {
    if (isApplePlatform()) {
        return 'computerMac';
    }

    return desktop()?.platform === 'win32' ? 'computerPc' : 'computer';
}

function Tag({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
    return (
        <span className={TAG}>
            <Icon icon={icon} size={12} />
            {children}
        </span>
    );
}

function MachineName({ id }: { id: string }) {
    const label = useEndpoints((s) => s.endpoints.find((endpoint) => endpoint.id === id)?.label ?? null);

    return label === null ? null : <Tag icon={Server}>{label}</Tag>;
}

function MachinePicker() {
    const { t } = useTranslation('settings');
    const listed = useListedMachines();
    const picked = usePickedMachine();
    const pick = usePickedMachineState((s) => s.pick);

    if (picked === null) {
        return null;
    }

    if (listed.length < 2) {
        return <Tag icon={Server}>{picked.label}</Tag>;
    }

    return (
        <span className="inline-flex shrink-0 items-center gap-1 text-text-muted">
            <Icon icon={Server} size={12} />
            <Select
                value={picked.id}
                label={t('scope.pick')}
                size="sm"
                variant="ghost"
                align="end"
                items={listed.map((endpoint) => ({ value: endpoint.id, label: endpoint.label }))}
                onValueChange={pick}
            />
        </span>
    );
}

function WindowMachineName() {
    return <MachineName id={useEndpointId()} />;
}

type SettingsSectionProps = Omit<SectionProps, 'tag'> & {
    scope?: SettingsScope;
    /* For `machine`: `picked` follows the machine picked in the tag, the one all such sections share. Without it the section is about the machine of this window. */
    machine?: 'picked';
};

export function SettingsSection({ scope, machine, ...props }: SettingsSectionProps) {
    const { t } = useTranslation('settings');
    const tag =
        scope === 'computer' ? (
            <Tag icon={Laptop}>{t(`scope.${computerWords()}`)}</Tag>
        ) : scope === 'machine' ? (
            machine === 'picked' ? (
                <MachinePicker />
            ) : (
                <WindowMachineName />
            )
        ) : undefined;

    return <Section {...props} tag={tag} />;
}
