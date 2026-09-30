import { Fragment, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { entryTimeOf, statusWordOf, subagentFacts, taskIdOf } from '../subagent-list';
import { useSubagentItem } from '../subagent-view';
import { StatusIcon } from './ChatActivity';
import { Markdown } from './Markdown';
import { Icon, useNow } from '@basmilius/desktop-ui';
import { useModelName } from '../../agents/model-name';
import { useChatRow } from '../../state/chats';
import { chatHost } from '../../host';
import { useChatScope } from '../../scope';

/*
 * What a sub-agent is, over its conversation: its state and time, the model it runs on and what it
 * spent, and the task it was given behind a fold. Nothing for a conversation whose row the thread lost.
 */
export function SubagentInfo({ chatId, toolUseId }: { chatId: string; toolUseId: string }) {
    const { t } = useTranslation('agent-chat');
    const { id } = useChatScope();
    const item = useSubagentItem(chatId, toolUseId);
    const provider = useChatRow(chatId, (row) => row?.info.provider);
    const task = chatHost().tasks.useTask(id, item === null ? null : taskIdOf(item));
    const modelName = useModelName(provider, item?.model ?? '');
    const now = useNow(1000, item?.status === 'running');
    const [open, setOpen] = useState(false);
    if (item === null) {
        return null;
    }
    const word = statusWordOf(item, task);
    const facts = subagentFacts(item, item.model === undefined ? null : modelName);
    return (
        <section aria-label={t('subagents.info.label')} className="shrink-0 border-b border-border px-4 py-2">
            <div className="chat-column-content flex flex-col gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs text-text-faint">
                    <StatusIcon word={word} />
                    <span className="sr-only">{t(`common.status.${word}`)}</span>
                    <span className="shrink-0 text-text-muted tabular-nums">{entryTimeOf(item, task, now)}</span>
                    {facts.map((fact) => (
                        <Fragment key={fact}>
                            <span aria-hidden="true">·</span>
                            <span className="min-w-0 truncate">{fact}</span>
                        </Fragment>
                    ))}
                    <span className="grow" />
                    {item.prompt && (
                        <button
                            type="button"
                            className="flex shrink-0 items-center gap-1.5 text-text-muted hover:text-text"
                            aria-expanded={open}
                            onClick={() => setOpen((current) => !current)}
                        >
                            <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />
                            {open ? t('subagents.info.hideTask') : t('subagents.info.showTask')}
                        </button>
                    )}
                </div>
                {open && item.prompt && (
                    <div className="max-h-60 overflow-auto rounded-md border border-border bg-surface-raised px-3 py-2 text-xs select-text">
                        <Markdown text={item.prompt} />
                    </div>
                )}
            </div>
        </section>
    );
}
