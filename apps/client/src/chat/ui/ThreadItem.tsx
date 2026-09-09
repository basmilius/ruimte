import { Suspense, lazy, useState } from 'react';
import clsx from 'clsx';
import { AlertCircle, Check, ChevronRight, FileCode2, Info, Loader2, Wrench, X } from 'lucide-react';
import type { ChatApprovalItem, ChatItem, ChatToolItem } from '@ruimte/contracts';
import { chatClient } from '@/chat';
import { fileChanges, isFileChange, toolSummary } from '@/chat/ui/tools';

// The diff renderer carries shiki; it only loads once a thread shows a file change.
const EditDiff = lazy(() => import('@/chat/ui/EditDiff'));

const OUTPUT_LIMIT = 4000;

const clip = (text: string): string => (text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n[${text.length - OUTPUT_LIMIT} more characters]` : text);

function ToolBlock({ item }: { item: ChatToolItem }) {
    const changes = fileChanges(item.name, item.input);
    const [open, setOpen] = useState(changes.length > 0);
    const summary = toolSummary(item.name, item.input);
    return (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
            <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text-muted hover:bg-surface-sunken"
                onClick={() => setOpen((o) => !o)}
            >
                <ChevronRight size={13} className={clsx('shrink-0 transition-transform', open && 'rotate-90')} />
                {isFileChange(item.name) ? <FileCode2 size={13} className="shrink-0" /> : <Wrench size={13} className="shrink-0" />}
                <span className="font-medium text-text">{item.name}</span>
                <span className="min-w-0 truncate font-mono">{summary}</span>
                <span className="grow" />
                {item.state === 'running' && <Loader2 size={13} className="shrink-0 animate-spin" />}
                {item.state === 'error' && <AlertCircle size={13} className="shrink-0 text-status-error" />}
            </button>
            {open && (
                <div className="border-t border-border">
                    <Suspense fallback={<div className="px-3 py-2 text-[12px] text-text-faint">Loading diff</div>}>
                        {changes.map((change, index) => (
                            <EditDiff key={index} change={change} />
                        ))}
                    </Suspense>
                    {changes.length === 0 && (
                        <pre className="max-h-64 overflow-auto bg-term-bg px-3 py-2 font-mono text-[11.5px] leading-[1.6] text-term-dim select-text">
                            {clip(JSON.stringify(item.input, null, 2) ?? '')}
                        </pre>
                    )}
                    {item.output !== null && item.output !== '' && (
                        <pre
                            className={clsx(
                                'max-h-64 overflow-auto whitespace-pre-wrap border-t border-border bg-term-bg px-3 py-2 font-mono text-[11.5px] leading-[1.6] select-text',
                                item.state === 'error' ? 'text-term-red' : 'text-term-fg'
                            )}
                        >
                            {clip(item.output)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}

const DECISION_LABEL: Record<Exclude<ChatApprovalItem['decision'], 'pending'>, string> = {
    allow: 'Allowed',
    deny: 'Denied',
    cancelled: 'No longer needed'
};

function ApprovalCard({ chatId, item }: { chatId: string; item: ChatApprovalItem }) {
    const summary = toolSummary(item.toolName, item.input);
    const changes = fileChanges(item.toolName, item.input);
    const decide = (decision: 'allow' | 'deny'): void => {
        void chatClient.approve(chatId, item.requestId, decision).catch(() => undefined);
    };
    return (
        <div className={clsx('overflow-hidden rounded-lg border bg-surface-raised', item.decision === 'pending' ? 'border-status-needs-you' : 'border-border')}>
            <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-muted">
                <Wrench size={13} className="shrink-0" />
                <span className="font-medium text-text">{item.toolName}</span>
                <span className="min-w-0 truncate font-mono">{summary}</span>
            </div>
            {item.description && <p className="px-3 pb-2 text-[12px] text-text-muted">{item.description}</p>}
            {changes.length > 0 && (
                <div className="border-t border-border">
                    <Suspense fallback={<div className="px-3 py-2 text-[12px] text-text-faint">Loading diff</div>}>
                        {changes.map((change, index) => (
                            <EditDiff key={index} change={change} />
                        ))}
                    </Suspense>
                </div>
            )}
            {changes.length === 0 && item.toolName === 'Bash' && (
                <pre className="border-t border-border bg-term-bg px-3 py-2 font-mono text-[11.5px] leading-[1.6] text-term-fg select-text">
                    {toolSummary('Bash', { command: (item.input as { command?: string })?.command })}
                </pre>
            )}
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                {item.decision === 'pending' ? (
                    <>
                        <span className="grow text-[12px] text-text-muted">Claude Code wants to run this</span>
                        <button
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium text-text hover:bg-surface-sunken"
                            onClick={() => decide('deny')}
                        >
                            <X size={13} /> Deny
                        </button>
                        <button
                            className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-text"
                            onClick={() => decide('allow')}
                        >
                            <Check size={13} /> Allow
                        </button>
                    </>
                ) : (
                    <span className="text-[12px] text-text-faint">{DECISION_LABEL[item.decision]}</span>
                )}
            </div>
        </div>
    );
}

export function ThreadItem({ chatId, item }: { chatId: string; item: ChatItem }) {
    switch (item.kind) {
        case 'user':
            return (
                <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13px] leading-relaxed text-text select-text">
                        {item.text}
                    </div>
                </div>
            );
        case 'assistant':
            return (
                <div className="max-w-[92%] whitespace-pre-wrap text-[13px] leading-relaxed text-text select-text">
                    {item.text}
                    {item.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-text-faint align-middle" />}
                </div>
            );
        case 'tool':
            return (
                <div className="max-w-[92%]">
                    <ToolBlock item={item} />
                </div>
            );
        case 'approval':
            return (
                <div className="max-w-[92%]">
                    <ApprovalCard chatId={chatId} item={item} />
                </div>
            );
        case 'note':
            return (
                <div className={clsx('flex items-center gap-1.5 text-[12px]', item.level === 'error' ? 'text-status-error' : 'text-text-faint')}>
                    {item.level === 'error' ? <AlertCircle size={13} /> : <Info size={13} />}
                    {item.text}
                </div>
            );
    }
}
