import type { Command } from '@/commands/behavior';
import { runAction } from '@/extensions/action-runs';
import { useInstalledExtensions } from '@/extensions/loader';
import { useSlotOutlines } from '@/extensions/slot-outlines';
import { baseContext, nodeInfoOf, resolveSlot } from '@/extensions/slots';
import { focusedCanvas } from '@/state/canvas';
import type { Contributions } from '@/state/extension-registry';

/* The commands and actions the installed extensions add to the palette. */
export type ExtensionRows = Pick<Contributions, 'commands' | 'slotEntries'>;

export function extensionCommands({ commands, slotEntries }: ExtensionRows): Command[] {
    const developing = useInstalledExtensions.getState().installed.some((entry) => entry.dev);
    const outlines: Command[] = developing
        ? [
              {
                  id: 'extension:slots',
                  label: useSlotOutlines.getState().on ? 'Hide extension slots' : 'Show extension slots',
                  run: () => useSlotOutlines.setState(({ on }) => ({ on: !on }))
              }
          ]
        : [];
    const context = { ...baseContext(), nodes: focusedCanvas().getState().selection.map(nodeInfoOf) };

    return [
        ...outlines,
        ...commands
            .filter((command) => command.when?.() ?? true)
            .map((command) => ({
                id: command.id,
                label: command.title,
                // Someone else's code, so a throw reaches a person as an action's does.
                run: () =>
                    void runAction(
                        {
                            id: command.id,
                            title: command.title,
                            run: () => command.run(),
                            ...(command.onFailure === undefined ? {} : { onFailure: command.onFailure })
                        },
                        {},
                        'commandPalette'
                    )
            })),
        ...resolveSlot(slotEntries, 'commandPalette', context).flatMap(({ entry, title, disabled }) =>
            entry.kind === 'action' && !disabled
                ? [
                      {
                          id: `extension:${entry.id}`,
                          label: entry.addsNode === true ? `Add ${title}` : title,
                          run: () => void runAction({ ...entry, title }, context, 'commandPalette')
                      }
                  ]
                : []
        )
    ];
}
