'use client';

import { Input, SectionLabel } from '@adecore/ui';
import { AppWindow as PageIcon, Bot, CalendarClock, FileText, HardDrive, Hash, Image, type LucideIcon, Search, User } from 'lucide-react';
import { IconButton } from '../../app/primitives.tsx';
import { Stage } from '../../film/Stage.tsx';
import { GuideWindow, SidePanel } from './parts.tsx';

interface Item {
    readonly title: string;
    readonly kind: LucideIcon;
    readonly source: LucideIcon;
    readonly versions: string;
    readonly at: string;
}

/* `output/kinds.ts` for the kind, `SOURCE_ICONS` in `OutputPanel.tsx` for who made it. */
const TODAY: readonly Item[] = [
    { title: 'Morning summary', kind: FileText, source: CalendarClock, versions: '6 versions', at: '09:02' },
    { title: 'Checkout flame graph', kind: Image, source: Bot, versions: '1 version', at: '08:41' }
];
const WEEK: readonly Item[] = [{ title: 'Cart page mockup', kind: PageIcon, source: User, versions: '3 versions', at: 'Tue' }];

/* The Output panel (`output/OutputPanel.tsx`): search, rows grouped by day, and the storage line at its foot. */
export function OutputPanel() {
    return (
        <Stage
            width={1040}
            height={480}
            label="The Output panel at the right. Under Today, a morning summary a routine wrote with 6 versions and a flame graph an agent made; under This week, a page mockup you saved. At the foot, how many items show and their size."
        >
            <GuideWindow
                view={{ icon: Hash, name: 'Checkout' }}
                selected="checkout"
                panel="output"
                sidePanel={
                    <SidePanel title="Output" width={320} actions={<IconButton icon={Search} size="sm" active />}>
                        <div className="flex shrink-0 px-2 pt-2">
                            <Input icon={Search} className="min-w-0 grow" placeholder="Search Output" readOnly />
                        </div>
                        <div className="min-h-0 grow overflow-hidden px-2 pb-2">
                            <Group label="Today" items={TODAY} />
                            <Group label="This week" items={WEEK} />
                        </div>
                        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-text-muted">
                            <HardDrive size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                            <span className="grow truncate tabular-nums">3 shown, 18.4 MB</span>
                        </div>
                    </SidePanel>
                }
            >
                <div className="canvas-dots absolute inset-0" />
            </GuideWindow>
        </Stage>
    );
}

function Group({ label, items }: { readonly label: string; readonly items: readonly Item[] }) {
    return (
        <section className="flex flex-col gap-0.5">
            <SectionLabel className="px-2 pt-3 pb-1">{label}</SectionLabel>
            {items.map(({ title, kind: Kind, source: Source, versions, at }) => (
                <div key={title} className="flex min-w-0 items-start gap-2.5 rounded-md px-2 py-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-field text-text-muted inset-ring inset-ring-field-border">
                        <Kind size={16} strokeWidth={1.75} />
                    </span>
                    <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-sm font-medium text-text">{title}</span>
                        <span className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
                            <Source size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                            <span className="truncate">{versions}</span>
                        </span>
                    </span>
                    <span className="shrink-0 text-xs text-text-faint tabular-nums">{at}</span>
                </div>
            ))}
        </section>
    );
}
