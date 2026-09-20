import type { ChatItem } from '@ruimte/contracts';
import type { ActionOutput } from '@ruimte/actions';

export function agentActivity(items: ChatItem[], limit: number, toolId: string | null): Pick<ActionOutput<'agent.activity'>, 'tools' | 'truncated'> {
    const all = items.filter((item) => item.kind === 'tool');
    const selected = toolId ? all.filter((item) => item.id === toolId || item.toolUseId === toolId) : all.slice(-limit);
    const tools = selected.map((item) => {
        const args = item.input && typeof item.input === 'object' ? (item.input as Record<string, unknown>) : {};
        const input = ['description', 'command', 'file_path', 'path', 'pattern', 'query']
            .flatMap((key) => (typeof args[key] === 'string' ? [`${key}: ${args[key]}`] : []))
            .join('\n');
        const output = toolId ? (item.output ?? item.progress?.output ?? null) : null;
        return {
            id: item.toolUseId,
            name: item.name,
            state: item.state,
            createdAt: item.createdAt,
            input: input.slice(0, 600),
            output: output?.slice(0, 6000) ?? null,
            parentToolUseId: item.parentToolUseId,
            paths: (item.changes ?? []).slice(0, 10).map((change) => change.path.slice(0, 300)),
            truncated: input.length > 600 || (output?.length ?? 0) > 6000 || (item.changes?.length ?? 0) > 10
        };
    });
    return { tools, truncated: (!toolId && all.length > limit) || tools.some((tool) => tool.truncated) };
}
