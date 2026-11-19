import { LazyBoundary } from '@adecore/ui';
import { PaneTabs } from '@/settings/PaneTabs';
import { navSectionOf, sectionLabel, tabSectionsOf } from '@/settings/sections';
import { useUi } from '@/state/ui';

/*
 * The pane of a section that has tab sections. The dialog mounts only the pane of the open section, so the section the
 * person is on says both which tabs to draw and which one is picked.
 */
export function SectionTabsPane() {
    const section = useUi((s) => s.settings.section);
    const setSettings = useUi((s) => s.setSettings);
    const parent = navSectionOf(section);
    const tabs = tabSectionsOf(parent);
    const active = tabs.find((tab) => tab.id === section) ?? tabs[0];

    if (active === undefined) {
        return null;
    }

    const Pane = active.pane;

    return (
        <>
            <PaneTabs
                value={active.id}
                tabs={tabs.map((tab) => ({ id: tab.id, label: tab.label() }))}
                label={sectionLabel(parent)}
                onValueChange={(next) => setSettings({ section: next })}
            />
            {/* Its own boundary, so the tabs stay while the next tab's pane loads. */}
            <LazyBoundary key={active.id}>
                <Pane />
            </LazyBoundary>
        </>
    );
}
