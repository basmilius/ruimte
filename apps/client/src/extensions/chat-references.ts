import type { Referable } from '@adecore/agents-react/chat';
import { useEffect, useState } from 'react';
import { useContributions } from '@/extensions/registry';

/* Things from outside the project for `#`, asked for once per chat box. They come down to text in the prompt. */
export function useExtensionReferables(): readonly Referable[] {
    const references = useContributions((state) => state.references);
    const [items, setItems] = useState<readonly Referable[]>([]);

    useEffect(() => {
        let current = true;

        void Promise.allSettled(
            references.map(async (reference) =>
                (await reference.list()).map((item): Referable => ({
                    id: `${reference.id}/${item.id}`,
                    name: item.name,
                    kind: 'note',
                    group: 'views',
                    read: () => reference.read(item)
                }))
            )
        ).then((answers) => {
            if (current) {
                setItems(answers.flatMap((answer) => (answer.status === 'fulfilled' ? answer.value : [])));
            }
        });

        return () => {
            current = false;
        };
    }, [references]);

    return items;
}
