import { SettingsSection } from '@adecore/ui/settings';
import { projectSettingKey } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { useMachineStorage } from '@/extensions/host/machine-storage';
import { SettingFieldRow } from '@/extensions/SchemaSettings';
import { useProjectSettingsSubject } from '@/project/project-settings-subject';
import { projectSettingRowId, useContributions, type SettingField } from '@/state/extension-registry';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';

function Field({ id, name, field }: { id: string; name: string; field: SettingField }) {
    const { t } = useTranslation('shell');
    const { project, endpointId } = useProjectSettingsSubject();
    // The machine the dialog's project lives on, which is not always the one in front.
    const [value, write] = useMachineStorage<boolean | string>(
        machineTransport(endpointId),
        endpointId,
        id,
        projectSettingKey(project.projectId, field.key),
        field.default,
        (text) => useToasts.getState().show({ kind: 'error', title: t('extensions.storageFailed', { name }), description: text })
    );

    return <SettingFieldRow field={field} value={value} onChange={write} searchId={projectSettingRowId(id, field.key)} />;
}

/*
 * The fields an extension named for a project, in the dialog of that project's settings. What a person chooses is kept
 * with what the extension stores on the project's machine, so `server/` reads it and no project file changes.
 */
export function ProjectSchemaSettings({ id }: { id: string }) {
    const section = useContributions((state) => state.projectSettings.find((each) => each.id === id));

    if (section === undefined) {
        return null;
    }

    return section.groups.map((group, index) => (
        <SettingsSection
            key={group.title ?? index}
            {...(group.title === undefined ? {} : { title: group.title })}
            {...(group.description === undefined ? {} : { description: group.description })}
        >
            {group.fields.map((field) => (
                <Field key={field.key} id={id} name={section.title} field={field} />
            ))}
        </SettingsSection>
    ));
}
