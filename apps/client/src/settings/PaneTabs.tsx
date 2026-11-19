import { Tabs } from '@adecore/ui';

interface PaneTab<Id extends string> {
    readonly id: Id;
    readonly label: string;
}

interface PaneTabsProps<Id extends string> {
    readonly value: Id;
    readonly tabs: readonly PaneTab<NoInfer<Id>>[];
    readonly label: string;
    onValueChange(next: NoInfer<Id>): void;
}

/* The tabs over a settings pane; the pane draws the picked tab under them itself. */
export function PaneTabs<Id extends string>({ value, tabs, label, onValueChange }: PaneTabsProps<Id>) {
    return (
        <Tabs.Root value={value} onValueChange={(next) => onValueChange(next as Id)} className="shrink-0">
            <Tabs.List aria-label={label}>
                {tabs.map((tab) => (
                    <Tabs.Tab key={tab.id} value={tab.id}>
                        {tab.label}
                    </Tabs.Tab>
                ))}
            </Tabs.List>
        </Tabs.Root>
    );
}
