import { DictationTextarea } from '@/dictation/DictationTextarea';
import { Suspense, lazy, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ChatApprovalItem } from '@ruimte/contracts';
import { approvalChanges, fileChanges } from '@/chat/logic/tools';
import { isApplePlatform } from '@/desktop/bridge';
import { isPrimaryKey } from '@/prompts/logic/keys';
import type { PromptDraft } from '@/prompts/logic/prompts';
import { Button } from '@/ui/Button';
import { TextMenu } from '@/ui/TextMenu';

const EditDiff = lazy(() => import('@/chat/ui/EditDiff'));
const UnifiedDiff = lazy(() => import('@/chat/ui/UnifiedDiff'));

/* A command in the sunken box a person reads before allowing it, with the folder it runs in when that is known. */
export function CommandBox({ command, cwd }: { command: string; cwd?: string }) {
    return (
        <TextMenu className="rounded-xl bg-surface-sunken p-3">
            {cwd !== undefined && <p className="mb-2 break-all font-mono text-xs text-text-muted select-text">{cwd}</p>}
            <pre className="whitespace-pre-wrap break-words font-mono text-code text-text select-text">{command}</pre>
        </TextMenu>
    );
}

function ApprovalDetails({ item }: { item: ChatApprovalItem }) {
    const { t } = useTranslation('prompts');
    const [expanded, setExpanded] = useState(false);
    const patches = approvalChanges(item.input);
    const edits = patches.length ? [] : fileChanges(item.toolName, item.input);
    const input = typeof item.input === 'object' && item.input !== null ? (item.input as Record<string, unknown>) : {};
    return (
        <>
            {item.description && <p className="text-sm text-text-muted">{item.description}</p>}
            {patches.length + edits.length > 1 && (
                <p className="text-xs text-text-muted">{t('approval.allChanges', { count: patches.length + edits.length })}</p>
            )}
            {patches.length + edits.length > 0 ? (
                <div className="overflow-hidden rounded-xl bg-surface-sunken">
                    <div className={clsx('overflow-auto', !expanded && 'max-h-44')}>
                        <Suspense fallback={<p className="p-3 text-xs text-text-muted">{t('approval.loadingDiff')}</p>}>
                            {patches.map((change, i) => (
                                <UnifiedDiff key={i} change={change} />
                            ))}
                            {edits.map((change, i) => (
                                <EditDiff key={i} change={change} />
                            ))}
                        </Suspense>
                    </div>
                    <div className="flex items-center border-t border-border p-1">
                        <Button size="sm" className="rounded-full!" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                            {expanded ? t('approval.collapseDiff') : t('approval.viewDiff')}
                        </Button>
                    </div>
                </div>
            ) : typeof input.command === 'string' ? (
                <CommandBox command={input.command} cwd={typeof input.cwd === 'string' ? input.cwd : undefined} />
            ) : (
                <details>
                    <summary className="flex h-7 cursor-pointer items-center text-xs text-text-muted">{t('approval.details')}</summary>
                    <TextMenu>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-sunken p-3 font-mono text-code text-text select-text">
                            {JSON.stringify(item.input, null, 2)}
                        </pre>
                    </TextMenu>
                </details>
            )}
        </>
    );
}

/* A chat's permission request: the diff, the command or the raw input, and the reason a Deny may carry. */
export function ApprovalBody({
    item,
    draft,
    onDraft,
    denyReason,
    locked
}: {
    item: ChatApprovalItem;
    draft: PromptDraft;
    onDraft(draft: PromptDraft): void;
    denyReason: boolean;
    locked: boolean;
}) {
    const { t } = useTranslation('prompts');
    return (
        <>
            <ApprovalDetails item={item} />
            {denyReason && draft.showReason && (
                <DictationTextarea
                    className="field min-h-16 text-sm"
                    autoFocus
                    aria-label={t('approval.reasonLabel')}
                    placeholder={t('approval.reasonPlaceholder')}
                    disabled={locked}
                    value={draft.reason}
                    onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
                    onKeyDown={(e) => {
                        // Mod+Enter presses Allow everywhere else in the card, which is the opposite of what a reason for declining is typed for.
                        if (isPrimaryKey(e.nativeEvent, isApplePlatform())) {
                            e.preventDefault();
                        }
                    }}
                />
            )}
        </>
    );
}
