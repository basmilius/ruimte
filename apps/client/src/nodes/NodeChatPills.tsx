import { AccountPill, GoalPill, LimitPill } from '@adecore/agents-react/chat/ui';
import { ComputerIndicator } from '@/computer/ComputerIndicator';
import { ChatHostPills } from '@/issues/ChatHostPills';
import { ForkPill } from '@/nodes/ForkPill';
import { PlanPill } from '@/plan/PlanPill';
import type { NodeHeaderProps } from '@/registry/node-kinds';

export function NodeChatPills({ id, chatId, renaming }: NodeHeaderProps) {
    if (renaming) {
        return null;
    }
    return (
        <>
            <AccountPill chatId={chatId} />
            <ForkPill chatId={chatId} />
            <PlanPill chatId={chatId} />
            <ChatHostPills chatId={chatId} />
            <LimitPill chatId={chatId} />
            <GoalPill chatId={chatId} />
            <ComputerIndicator nodeId={id} />
        </>
    );
}
