import type { TimelineRow } from '../../logic/timeline';
import type { SubagentStep } from '../../subagent-view';
import { AgentTurnRow, ApprovalHistoryRow, AssistantRow, CompactionRow, NoteRow, QuestionHistoryRow, ReportRow, ThinkingRow, UserRow } from './MessageRows';
import { ForksRow } from './ForksRow';
import { SubagentBranchRow } from './SubagentRow';
import { WorkflowRow } from './WorkflowRow';
import { ChangedFilesRow, TurnFoldRow, WorkGroupRow, WorkLiveRow, WorkRow, WorkingRow } from './WorkRows';

export interface RowProps {
    row: TimelineRow;
    chatId: string;
    toggleGroup(id: string): void;
    toggleTurn(id: string): void;
    toggleSubagent(id: string): void;
    openSubagent(toolUseId: string): void;
    /* Opens the whole conversation of a subagent or a workflow's agent in the thread's place; absent where there is nowhere to open it. */
    openConversation?(step: SubagentStep): void;
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
            return <ReportRow id={row.id} text={row.text} />;
        case 'thinking':
            return <ThinkingRow chatId={chatId} item={row.item} />;
        case 'work':
            return <WorkRow tool={row.tool} />;
        case 'work-live':
            return <WorkLiveRow tool={row.tool} />;
        case 'workflow':
            return <WorkflowRow tool={row.tool} workflow={row.workflow} onOpenAgent={openConversation} />;
        case 'work-group':
            return <WorkGroupRow tools={row.tools} summary={row.summary} expanded={row.expanded} onToggle={() => toggleGroup(row.id)} />;
        case 'subagent':
            return <SubagentBranchRow branch={row} onToggle={toggleSubagent} onOpenConversation={openConversation} />;
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
            return <NoteRow id={row.id} level={row.level} text={row.text} from={row.from} />;
        case 'compaction':
            return <CompactionRow preTokens={row.preTokens} />;
        case 'working':
            return <WorkingRow startedAt={row.startedAt} />;
    }
}
