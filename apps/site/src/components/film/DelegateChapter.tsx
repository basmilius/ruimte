'use client';

import { GitBranch, GitMerge } from 'lucide-react';
import { CanvasEdge, CanvasNode } from '../app/canvas.tsx';
import { AssistantText, Composer, ToolRow, UserBubble, WorkingRow } from '../app/chat.tsx';
import { Dock } from '../app/chrome.tsx';
import type { Rect } from '../app/edge-route.ts';
import { Reveal } from '../app/primitives.tsx';
import { CHILDREN, childStatus, leadStatus } from './script.ts';

const LEAD: Rect = { x: 44, y: 96, w: 380, h: 452 };

export function DelegateChapter({ step }: { readonly step: number }) {
    const open = CHILDREN.filter((child) => step >= 2 && step < child.doneAt).length;
    const done = CHILDREN.filter((child) => step >= child.doneAt).length;

    return (
        <div className="canvas-dots absolute inset-0 overflow-hidden">
            <div className="absolute top-3 left-11 text-[18px] font-medium text-text">Dark theme</div>

            {CHILDREN.map((child, i) => (
                <CanvasEdge key={child.id} from={LEAD} to={child.rect} look={step >= child.doneAt ? 'context' : 'task'} shown={step >= 2} delay={i * 0.12} />
            ))}

            <CanvasNode rect={LEAD} kind="chat" agent title="Theme lead" status={leadStatus(step)}>
                <div className="flex h-full flex-col">
                    <div className="flex min-h-0 grow flex-col gap-3 overflow-hidden px-4 pt-4">
                        <UserBubble>Give the app a dark theme. Split the work up.</UserBubble>
                        <AssistantText shown={step >= 1} text="Three tasks, each agent in a worktree of its own, so nobody touches another's files." />
                        <Reveal shown={step >= 2}>
                            <ToolRow tool="bash" label="Started" detail="3 agents" />
                        </Reveal>
                        <Reveal shown={step >= 3 && step < 6} className="text-[13px] leading-[19px] text-text-faint">
                            Waiting on {open} {open === 1 ? 'task' : 'tasks'}
                        </Reveal>
                        <AssistantText shown={step >= 6} text="All three are in. Merging their worktrees into main." />
                        <Reveal shown={step >= 7} className="flex items-center gap-2 text-[13px] text-status-idle">
                            <GitMerge size={14} strokeWidth={1.75} /> Merged 3 branches, 41 files
                        </Reveal>
                    </div>
                    <div className="px-3 pt-2 pb-3">
                        <Composer />
                    </div>
                </div>
            </CanvasNode>

            {CHILDREN.map((child, i) => {
                const status = childStatus(child, step);
                const finished = status === 'idle';
                return (
                    <CanvasNode
                        key={child.id}
                        rect={child.rect}
                        kind="chat"
                        agent
                        title={child.id}
                        status={step >= 2 ? status : undefined}
                        shown={step >= 2}
                        delay={0.2 + i * 0.12}
                    >
                        <div className="flex h-full flex-col gap-1.5 px-4 pt-3">
                            <div className="truncate text-[14px] leading-[21px] text-text">{child.task}</div>
                            <div className="flex items-center gap-1.5 text-[13px] text-text-muted">
                                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-surface-sunken px-2">
                                    <GitBranch size={12} strokeWidth={1.75} />
                                    <span className="font-mono">ruimte/{child.id}</span>
                                </span>
                            </div>
                            {step >= 3 && <ToolRow tool="edit" label={finished ? 'Edited' : 'Edit'} detail={child.tool} live={!finished} />}
                            {step >= 3 && !finished && <WorkingRow seconds={8 + step * 5 + i * 3} />}
                            {finished && <div className="text-[13px] leading-[19px] text-status-idle">Task done</div>}
                        </div>
                    </CanvasNode>
                );
            })}

            <div className="absolute inset-x-0 bottom-4 flex justify-center">
                <Dock working={step >= 2 ? open + (leadStatus(step) === 'running' ? 1 : 0) : 1} finished={done} />
            </div>
        </div>
    );
}
