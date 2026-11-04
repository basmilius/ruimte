'use client';

import { ChevronDown, ChevronRight, Database, KeyRound, Plus, Table } from 'lucide-react';
import { IconButton } from '../../app/primitives.tsx';
import { Stage } from '../../film/Stage.tsx';
import { GuideWindow, SidePanel } from './parts.tsx';

const COLUMNS = [
    { name: 'id', width: 72, key: true, numeric: true },
    { name: 'user_id', width: 96, numeric: true },
    { name: 'items', width: 72, numeric: true },
    { name: 'total', width: 96, numeric: true },
    { name: 'saved_at', width: 190 },
    { name: 'coupon', width: 110 }
] as const;

const ROWS: readonly (readonly (string | null)[])[] = [
    ['1041', '7', '3', '119.00', '2026-10-28 14:02:11', null],
    ['1042', '12', '1', '15.00', '2026-10-29 09:47:38', 'WELCOME10'],
    ['1043', '7', '5', '204.50', '2026-10-30 18:20:05', null],
    ['1044', '31', '2', '89.00', '2026-11-01 11:13:44', null],
    ['1045', '18', '4', '162.25', '2026-11-02 08:31:59', 'AUTUMN']
];

/*
 * A table in the data grid of `@adecore/database` (`grid/GridHeaderCell.tsx`, `GridRowView.tsx`): a 32px
 * header and 28px rows in the code font, numbers to the right and NULL in the faint text, beside the
 * Databases panel with its connection open on the tables.
 */
export function DatabaseTable() {
    return (
        <Stage
            width={1040}
            height={440}
            label="The carts table of a MySQL connection, open as a view: columns id, user_id, items, total, saved_at and coupon, with NULL in faint text. The Databases panel at the right lists the connection shop and its tables."
        >
            <GuideWindow
                view={{ icon: Table, name: 'carts' }}
                panel="databases"
                sidePanel={
                    <SidePanel title="Databases" width={260} actions={<IconButton icon={Plus} size="sm" />}>
                        <div className="flex flex-col gap-px p-2 text-xs">
                            <Row depth={0} open icon={Database} name="shop" detail="MySQL" />
                            <Row depth={1} icon={Table} name="carts" selected />
                            <Row depth={1} icon={Table} name="orders" />
                            <Row depth={1} icon={Table} name="users" />
                        </div>
                    </SidePanel>
                }
            >
                <div className="absolute inset-0 overflow-hidden bg-surface font-mono text-[13px]">
                    <div className="flex h-8 border-b border-border bg-surface">
                        {COLUMNS.map((column, index) => (
                            <div
                                key={column.name}
                                className={`flex h-full shrink-0 items-center gap-1.5 overflow-hidden px-3 font-medium text-text-muted ${'numeric' in column ? 'justify-end' : ''} ${index < COLUMNS.length - 1 ? 'border-r border-border-soft' : ''}`}
                                style={{ width: column.width }}
                            >
                                {'key' in column && <KeyRound size={12} strokeWidth={1.75} className="shrink-0 text-(--file-icon-yellow)" />}
                                <span className="truncate">{column.name}</span>
                            </div>
                        ))}
                    </div>
                    {ROWS.map((row) => (
                        <div key={row[0]} className="flex h-7 border-b border-border-soft">
                            {row.map((value, index) => {
                                const column = COLUMNS[index]!;

                                return (
                                    <div
                                        key={column.name}
                                        className={`flex h-full shrink-0 items-center overflow-hidden px-3 whitespace-nowrap ${'numeric' in column ? 'justify-end tabular-nums' : ''} ${index < COLUMNS.length - 1 ? 'border-r border-border-soft' : ''}`}
                                        style={{ width: column.width }}
                                    >
                                        <span className={value === null ? 'text-text-faint' : 'text-text'}>{value ?? 'NULL'}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </GuideWindow>
        </Stage>
    );
}

function Row({
    depth,
    open,
    icon: Icon,
    name,
    detail,
    selected = false
}: {
    readonly depth: number;
    readonly open?: boolean;
    readonly icon: typeof Database;
    readonly name: string;
    readonly detail?: string;
    readonly selected?: boolean;
}) {
    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <div
            className={`flex h-7 items-center gap-1.5 rounded-md pr-2 ${selected ? 'bg-surface-active text-text' : 'text-text-muted'}`}
            style={{ paddingLeft: 8 + depth * 14 }}
        >
            {depth === 0 ? <Chevron size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" /> : <span className="w-3" />}
            <Icon size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" />
            <span className="min-w-0 truncate">{name}</span>
            {detail !== undefined && <span className="text-text-faint">{detail}</span>}
        </div>
    );
}
