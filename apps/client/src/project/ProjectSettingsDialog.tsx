import { SettingsDialog, type SettingsSearchResult } from '@adecore/ui/settings';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectSettingsContext, type ProjectSettingsSubject } from '@/project/project-settings-subject';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { projectSettingsSectionRegistry, type ProjectSettingsSectionDefinition } from '@/registry/project-settings-sections';
import { currentEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';

interface ProjectSettingsDialogProps {
    subject: ProjectSettingsSubject | null;
    open: boolean;
    onOpenChange(open: boolean): void;
    onOpenChangeComplete(open: boolean): void;
}

function fold(text: string): string {
    return text.toLocaleLowerCase();
}

/* The sections and rows whose words hold every term of the query, a section before its rows. */
function findIn(sections: readonly ProjectSettingsSectionDefinition[], query: string): SettingsSearchResult[] {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    const matches = (...texts: string[]): boolean => terms.every((term) => texts.some((text) => fold(text).includes(term)));

    return sections.flatMap((section) => [
        ...(matches(section.label(), section.description()) ? [{ section: section.id, id: null, label: section.label() }] : []),
        ...section.rows.filter((row) => matches(row.label())).map((row) => ({ section: section.id, id: row.id, label: row.label() }))
    ]);
}

/*
 * The settings of one project, in the dialog the app's own settings use: a section per subject, each from
 * the feature that owns it (`registry/project-settings-sections.ts`). The dialog keeps the last project it
 * was on, so its panes still draw while it closes, and it is there closed before the first project, so
 * the first opening moves in like every later one.
 */
export function ProjectSettingsDialog({ subject, open, onOpenChange, onOpenChangeComplete }: ProjectSettingsDialogProps) {
    // The labels of the sections come from `i18next.t`, which no redraw follows: this is what draws them again in another language.
    const { t } = useTranslation('shell');

    const [shown, setShown] = useState(subject);
    const [section, setSection] = useState('general');
    const [target, setTarget] = useState<string | null>(null);
    const registered = projectSettingsSectionRegistry.useAll();
    const onScreen = useProject((s) => s.current?.projectId === shown?.project.projectId) && shown?.endpointId === currentEndpointId();

    if (subject !== null && subject !== shown) {
        setShown(subject);
    }

    const scratch = shown?.project.scratch === true;
    const sections = registered.filter((definition) => definition.available?.({ scratch, onScreen }) ?? true);

    return (
        <ProjectSettingsContext value={shown}>
            <SettingsDialog
                open={open}
                onOpenChange={(next) => {
                    onOpenChange(next);

                    // The shared dialog does not say when it has closed, and the kept project is what its panes draw until then.
                    if (!next) {
                        setSection('general');
                        onOpenChangeComplete(false);
                    }
                }}
                title={t('projectSettings.title')}
                heading={
                    shown !== null && (
                        <ProjectGlyph
                            projectId={shown.project.projectId}
                            endpointId={shown.endpointId}
                            icon={shown.project.icon}
                            color={shown.project.color}
                            size={20}
                            scratch={scratch}
                        />
                    )
                }
                section={sections.some((definition) => definition.id === section) ? section : 'general'}
                onNavigate={({ section: next, target: row }) => {
                    setSection(next);

                    if (row !== undefined) {
                        setTarget(row);
                    }
                }}
                groups={[
                    {
                        label: shown?.project.name ?? null,
                        sections: sections.map((definition) => ({
                            id: definition.id,
                            icon: definition.icon,
                            label: definition.label(),
                            description: definition.description(),
                            pane: definition.pane
                        }))
                    }
                ]}
                search={{ find: (query) => findIn(sections, query) }}
                target={target}
                onTargetShown={() => setTarget(null)}
            />
        </ProjectSettingsContext>
    );
}
