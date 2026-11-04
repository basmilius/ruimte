'use client';

import { Icon, Kbd } from '@adecore/ui';
import { Blocks, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Scaled } from '../../film/Stage.tsx';
import { SceneFrame } from './parts.tsx';

interface Row {
    readonly title: string;
    readonly hint?: string;
    readonly icon?: ReactNode;
}

/*
 * `@adecore/ui` `CommandPalette` over a dimmed window: the field with Esc, then one row per match as
 * `ComboboxItem` draws it, the first one under the cursor.
 */
function Palette({ query, rows }: { readonly query: string; readonly rows: readonly Row[] }) {
    return (
        <SceneFrame>
            <div className="canvas-dots grow" />
            <div className="absolute inset-0 bg-bg/55" />
            <div className="absolute top-14 left-1/2 flex w-[576px] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border border-border bg-surface-raised shadow-float">
                <div className="flex items-center gap-2 border-b border-border px-3">
                    <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />
                    <span className="flex h-11 grow items-center text-sm text-text">
                        {query}
                        <span className="caret ml-px inline-block h-4 w-px bg-current" />
                    </span>
                    <Kbd variant="inline">Esc</Kbd>
                </div>
                <div className="flex flex-col p-1.5">
                    {rows.map((row, index) => (
                        <span key={row.title} className={`menu-item ${index === 0 ? 'bg-surface-hover' : ''}`}>
                            {row.icon !== undefined && <span className="flex h-lh shrink-0 items-center text-text-faint">{row.icon}</span>}
                            <span className="min-w-0 truncate">{row.title}</span>
                            {row.hint !== undefined && <span className="min-w-0 truncate text-xs/[inherit] text-text-faint">{row.hint}</span>}
                        </span>
                    ))}
                </div>
            </div>
        </SceneFrame>
    );
}

/* A command and an action of an extension, found by a word of their titles. */
export function PaletteCommands() {
    return (
        <Scaled
            width={760}
            height={380}
            label="The command palette with 'standup' typed. It lists Open the standup and Write the standup, the command and the action of the extension."
        >
            <Palette query="standup" rows={[{ title: 'Open the standup' }, { title: 'Write the standup' }]} />
        </Scaled>
    );
}

/* Rows a palette source found for what a person typed, each with the source as its hint. */
export function PaletteSource() {
    const issue = <Icon icon={Blocks} size={14} />;

    return (
        <Scaled
            width={760}
            height={380}
            label="The command palette with 'login' typed. Three issues from the extension's own search are listed, each with its state beside the title."
        >
            <Palette
                query="login"
                rows={[
                    { title: 'Login forgets the email after a failed submit', hint: 'open', icon: issue },
                    { title: 'Login button stays disabled on Safari', hint: 'open', icon: issue },
                    { title: 'Remember me on the login page', hint: 'closed', icon: issue }
                ]}
            />
        </Scaled>
    );
}
