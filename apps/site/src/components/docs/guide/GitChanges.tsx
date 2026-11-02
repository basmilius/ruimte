'use client';

import { ChevronDown, GitBranch, GitCompare, MoreHorizontal, Sparkles } from 'lucide-react';
import { SectionLabel } from '@adecore/ui';
import { Button, IconButton } from '../../app/primitives.tsx';
import { Stage } from '../../film/Stage.tsx';
import { GuideWindow, SidePanel, TreeRow } from './parts.tsx';

const DIFF: readonly { readonly kind: ' ' | '+' | '-'; readonly text: string }[] = [
    { kind: ' ', text: "import { db } from './db';" },
    { kind: ' ', text: '' },
    { kind: '+', text: 'const DAYS_30 = 30 * 86_400_000;' },
    { kind: '+', text: '' },
    { kind: '+', text: 'export function expiresAt(cart: Cart): number {' },
    { kind: '+', text: '    return cart.savedAt + DAYS_30;' },
    { kind: '+', text: '}' },
    { kind: ' ', text: '' },
    { kind: ' ', text: 'export async function restoreCart(userId: string) {' },
    { kind: ' ', text: '    const cart = await db.carts.find(userId);' },
    { kind: '-', text: '    return cart;' },
    { kind: '+', text: '    return cart && expiresAt(cart) > Date.now() ? cart : null;' },
    { kind: ' ', text: '}' }
];

const TONE = { ' ': '', '+': 'bg-status-idle/12', '-': 'bg-status-error/12' } as const;

/* The Git panel with the branch chip in its header, the changes by kind and the commit box, beside the diff of one file. */
export function GitChanges() {
    return (
        <Stage
            width={1040}
            height={540}
            label="The Git panel at the right: the branch saved-carts in its header, the changed files grouped as code and tests, and the commit box with its message field and Commit button. Beside it, the diff of cart.ts shows added and removed lines."
        >
            <GuideWindow
                view={{ icon: GitCompare, name: 'cart.ts' }}
                selected="cart"
                panel="git"
                sidePanel={
                    <SidePanel
                        leading={
                            <span className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-text-muted">
                                <GitBranch size={12} strokeWidth={1.75} className="shrink-0" />
                                <span className="truncate font-mono">saved-carts</span>
                                <ChevronDown size={12} strokeWidth={1.75} className="shrink-0" />
                            </span>
                        }
                        actions={<IconButton icon={MoreHorizontal} size="sm" />}
                    >
                        <div className="flex min-h-0 grow flex-col gap-px overflow-hidden p-2 pt-1">
                            <SectionLabel className="px-2 pt-2 pb-1">Code</SectionLabel>
                            <TreeRow name="cart.ts" selected trailing={<span className="font-mono text-text-faint">M</span>} />
                            <TreeRow name="session.ts" trailing={<span className="font-mono text-text-faint">M</span>} />
                            <SectionLabel className="px-2 pt-3 pb-1">Tests</SectionLabel>
                            <TreeRow name="cart.test.ts" trailing={<span className="font-mono text-text-faint">A</span>} />
                        </div>
                        <div className="flex shrink-0 flex-col gap-2 p-2">
                            <div className="flex flex-col rounded-lg border border-field-border bg-field bg-clip-padding">
                                <div className="h-[72px] px-2.5 py-2 text-xs text-text-faint">Summary, then a blank line and the details</div>
                                <div className="flex items-center gap-2 p-1.5">
                                    <IconButton icon={Sparkles} size="sm" />
                                    <span className="grow" />
                                    <span className="flex">
                                        <Button variant="primary" size="xs" className="rounded-r-none">
                                            Commit
                                        </Button>
                                        <Button variant="primary" size="xs" className="rounded-l-none border-l border-white/20 px-1.5">
                                            <ChevronDown size={12} strokeWidth={1.75} />
                                        </Button>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </SidePanel>
                }
            >
                <div className="absolute inset-0 overflow-hidden bg-surface pt-2 font-mono text-[13px] leading-5">
                    {DIFF.map((line, index) => (
                        <div key={index} className={`flex ${TONE[line.kind]}`}>
                            <span className="w-8 shrink-0 text-center text-text-faint select-none">{line.kind === ' ' ? '' : line.kind}</span>
                            <span className="whitespace-pre text-text">{line.text}</span>
                        </div>
                    ))}
                </div>
            </GuideWindow>
        </Stage>
    );
}
