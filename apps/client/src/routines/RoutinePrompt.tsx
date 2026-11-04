import { MessageMarkdown } from '@adecore/agents-react/chat/ui';
import type { RoutineEntry } from '@ruimte/contracts';
import { useReferables } from '@/chat/referables';
import { useProject } from '@/state/project';

/* A routine's instructions as a message of a person reads, with the files, skills and views picked in it as chips. */
export function RoutinePrompt({ endpointId, entry }: { endpointId: string; entry: RoutineEntry }) {
    const openProjectId = useProject((s) => s.current?.projectId ?? null);
    const referables = useReferables(endpointId, '');
    if (entry.routine.kind !== 'agent') {
        return null;
    }
    const picked = entry.routine.picked;
    // Only the project open here has views this window can name; another project's stay their text.
    const items = openProjectId === entry.projectId ? referables.items : [];
    const references = [...(picked?.references ?? []), ...(picked?.chats ?? [])].flatMap((id) => {
        const name = items.find((item) => item.id === id)?.name;
        return name === undefined || name === '' ? [] : [{ id, name }];
    });
    return <MessageMarkdown text={entry.routine.prompt} mentions={picked?.mentions} skills={picked?.skills} references={references} />;
}
