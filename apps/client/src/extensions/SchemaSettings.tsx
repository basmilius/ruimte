import { Input, Select, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { settingKey, subscribeStorage, writeExtensionStorage } from '@/extensions/host/extension-storage';
import { useInstalledExtensions } from '@/extensions/loader';
import { SettingsSection } from '@/machines/SettingsSection';
import { useContributions, type SettingField } from '@/state/extension-registry';
import { storedText } from '@/state/stored-json';
import { useToasts } from '@/state/toasts';

function Field({ id, field }: { id: string; field: SettingField }) {
    const { t } = useTranslation('shell');
    const name = useInstalledExtensions((state) => state.installed.find((entry) => entry.manifest.id === id)?.manifest.name ?? id);
    const key = settingKey(id, field.key);
    const stored = useSyncExternalStore(subscribeStorage, () => storedText(key).read());
    const value = stored === null ? field.default : (JSON.parse(stored) as boolean | string);
    // The row reads back what is kept, so a refused write leaves the old value in view; this says why.
    const write = (next: boolean | string): void => {
        if (!writeExtensionStorage(key, next)) {
            useToasts.getState().show({ kind: 'error', title: t('extensions.storageFailed', { name }), description: field.label });
        }
    };

    return (
        <SettingsRow
            label={field.label}
            {...(field.description === undefined ? {} : { description: field.description })}
            control={
                field.type === 'boolean' ? (
                    <Switch checked={value === true} label={field.label} onCheckedChange={write} />
                ) : field.type === 'select' ? (
                    <Select value={String(value)} label={field.label} align="end" items={[...(field.options ?? [])]} onValueChange={write} />
                ) : (
                    <Input aria-label={field.label} value={String(value)} onChange={(event) => write(event.target.value)} />
                )
            }
        />
    );
}

/* Fields an extension named, in rows like any other setting and in sections when it groups them, so a simple one needs no React. */
export function SchemaSettings({ id }: { id: string }) {
    const schema = useContributions((state) => state.extensionSchemas.find((each) => each.id === id));

    if (schema === undefined) {
        return null;
    }

    return schema.groups.map((group, index) => (
        <SettingsSection
            key={group.title ?? index}
            {...(group.title === undefined ? {} : { title: group.title })}
            {...(group.description === undefined ? {} : { description: group.description })}
        >
            {group.fields.map((field) => (
                <Field key={field.key} id={id} field={field} />
            ))}
        </SettingsSection>
    ));
}
