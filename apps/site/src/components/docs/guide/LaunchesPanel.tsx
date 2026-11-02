'use client';

import { ChevronDown, CircleDot, ExternalLink, Hash, RotateCw, Square } from 'lucide-react';
import { TerminalBody } from '../../app/bodies.tsx';
import { IconButton } from '../../app/primitives.tsx';
import { Stage } from '../../film/Stage.tsx';
import { GuideWindow, SidePanel } from './parts.tsx';

/*
 * The Launches panel (`launches/LaunchesPanel.tsx`): the chosen launch in the header with its status, the
 * count of the others and its buttons; under it the command bar with the address, then the output.
 */
export function LaunchesPanel() {
    return (
        <Stage
            width={1180}
            height={500}
            label="The Launches panel. Its header shows the running launch dev server with two other launches behind +2, and the restart and stop buttons. Under it, the command bun dev with the address localhost:5173, and the dev server's output."
        >
            <GuideWindow
                view={{ icon: Hash, name: 'Checkout' }}
                selected="checkout"
                sidePanel={
                    <SidePanel
                        title="Launches"
                        width={440}
                        actions={
                            <>
                                <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-md pr-1.5 pl-2 text-xs">
                                    <CircleDot size={14} strokeWidth={1.75} className="shrink-0 text-positive" />
                                    <span className="min-w-0 truncate text-text">dev server</span>
                                    <span className="shrink-0 rounded-sm bg-surface-active px-1 text-text-muted tabular-nums">+2</span>
                                    <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
                                </span>
                                <span className="grow" />
                                <IconButton icon={RotateCw} size="xs" />
                                <IconButton icon={Square} size="xs" />
                            </>
                        }
                    >
                        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 font-mono text-xs text-text-faint">
                            <span className="shrink-0">$</span>
                            <span className="min-w-0 grow truncate text-text-muted">bun dev</span>
                            <span className="flex shrink-0 items-center gap-1 text-accent">
                                localhost:5173
                                <ExternalLink size={12} strokeWidth={1.75} />
                            </span>
                        </div>
                        <div className="relative min-h-0 grow">
                            <TerminalBody>
                                <div>
                                    <span className="text-ansi-green">VITE</span> v7.1.4 <span className="text-term-dim">ready in</span> 312 ms
                                </div>
                                <div> </div>
                                <div>
                                    {'  '}
                                    <span className="text-ansi-green">➜</span> Local: <span className="text-ansi-cyan">http://localhost:5173/</span>
                                </div>
                                <div> </div>
                                <div>
                                    <span className="text-term-dim">12:04:31</span> <span className="text-ansi-cyan">[vite]</span> hmr update /src/cart.ts
                                </div>
                            </TerminalBody>
                        </div>
                    </SidePanel>
                }
            >
                <div className="canvas-dots absolute inset-0" />
            </GuideWindow>
        </Stage>
    );
}
