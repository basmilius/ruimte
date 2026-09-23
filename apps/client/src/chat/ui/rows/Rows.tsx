import type { ChatSubagentItem } from '@ruimte/contracts';
import type { TimelineRow } from '@/chat/logic/timeline';
import {
    AgentTurnRow,
    ApprovalHistoryRow,
    AssistantRow,
    CompactionRow,
    NoteRow,
    QuestionHistoryRow,
    ReportRow,
    ThinkingRow,
    UserRow
} from '@/chat/ui/rows/MessageRows';
import { ForksRow } from '@/chat/ui/rows/ForksRow';
import { SubagentRow } from '@/chat/ui/rows/SubagentRow';
import { ChangedFilesRow, TurnFoldRow, WorkGroupRow, WorkLiveRow, WorkRow, WorkingRow } from '@/chat/ui/rows/WorkRows';

export interface RowProps {
    row: TimelineRow;
    chatId: string;
    toggleGroup(id: string): void;
    toggleTurn(id: string): void;
    toggleSubagent(id: string): void;
    openSubagent(toolUseId: string): void;
    /* Opens a subagent's whole conversation in the thread's place; absent where there is nowhere to open it. */
    openConversation?(item: ChatSubagentItem): void;
}

/* One row of a thread, the chat's own or a subagent's read back, drawn the same way in both. */
export function Row({ row, chatId, toggleGroup, toggleTurn, toggleSubagent, openSubagent, openConversation }: RowProps) {
    switch (row.kind) {
        case 'user':
            return <UserRow chatId={chatId} item={row.item} />;
        case 'turn-start': {
            const toolUseId = row.turn.taskToolUseId;
            return <AgentTurnRow label={row.label} onOpen={toolUseId ? () => openSubagent(toolUseId) : undefined} />;
        }
        case 'assistant':
            return <AssistantRow chatId={chatId} item={row.item} />;
        case 'report':
            return <ReportRow text={row.text} />;
        case 'thinking':
            return <ThinkingRow chatId={chatId} item={row.item} />;
        case 'work':
            return <WorkRow tool={row.tool} />;
        case 'work-live':
            return <WorkLiveRow tool={row.tool} />;
        case 'work-group':
            return <WorkGroupRow tools={row.tools} summary={row.summary} expanded={row.expanded} onToggle={() => toggleGroup(row.id)} />;
        case 'subagent':
            return (
                <SubagentRow
                    item={row.item}
                    work={row.children}
                    expanded={row.expanded}
                    onToggle={() => toggleSubagent(row.id)}
                    onOpenConversation={openConversation ? () => openConversation(row.item) : undefined}
                />
            );
        case 'turn-fold':
            return <TurnFoldRow turn={row.turn} label={row.label} work={row.work} expanded={row.expanded} onToggle={() => toggleTurn(row.turn.id)} />;
        case 'forks':
            return <ForksRow chatId={chatId} turnId={row.turnId} />;
        case 'changed-files':
            return <ChangedFilesRow chatId={chatId} turnId={row.turnId} tools={row.tools} diff={row.diff} checkpoint={row.checkpoint} />;
        case 'approval':
            return <ApprovalHistoryRow item={row.item} />;
        case 'question':
            return <QuestionHistoryRow item={row.item} />;
        case 'note':
            return <NoteRow level={row.level} text={row.text} from={row.from} />;
        case 'compaction':
            return <CompactionRow preTokens={row.preTokens} />;
        case 'working':
            return <WorkingRow startedAt={row.startedAt} />;
    }
}
