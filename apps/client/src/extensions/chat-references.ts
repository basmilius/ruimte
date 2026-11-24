import type { Referable } from '@adecore/agents-react/chat';
import { useEffect, useState } from 'react';
import { useMachineComposer } from '@/extensions/machine-composer';
import { useContributions } from '@/state/extension-registry';

/*
 * Things from outside the project for `#`, asked for once per chat box. They come down to text in the prompt. What an
 * extension's `client/` offers comes first, and its `server/` adds what that did not: a reference both define under one
 * id shows once, as the client's.
 */
export function useExtensionReferables(): readonly Referable[] {
    const references = useContributions((state) => state.references);
    const machine = useMachineComposer();
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

    const known = new Set(items.map((item) => item.id));
    const fromMachine = machine.references
        .map((reference): Referable => ({
            id: `${reference.extension}/${reference.reference}/${reference.id}`,
            name: reference.name,
            kind: 'note',
            group: 'views',
            read: () => machine.read(reference)
        }))
        .filter((item) => !known.has(item.id));

    return fromMachine.length === 0 ? items : [...items, ...fromMachine];
}
