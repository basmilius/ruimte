import { UI_GROUPS, uiGroupDescription, type UiGroupName } from '@adecore/intelligent-ui';
import { EXTENSION_UI_SOURCE } from '@ruimte/contracts/extension-providers';
import { z } from 'zod';
import { defineTool, defineToolkit } from './tool.ts';

const GROUP_NAMES = Object.keys(UI_GROUPS) as [UiGroupName, ...UiGroupName[]];

/* Host guidance supplements the catalog's group rules. */
const HOST_RULES: Partial<Record<UiGroupName, string>> = {
    content:
        'To show an image or model file of your own, attach it with chat_attach and its path, which prints the id for attachment="<id>" on Image, Gallery and Compare, or on Model for a binary glTF, USDZ or STL'
};

/* What the group is for, its rules, then a line per component with its props and what it is. */
function groupLines(group: UiGroupName): string[] {
    // Ruimte looks up no addresses, so an agent gives lat and lon for every Place.
    const { description, rules, components } = uiGroupDescription(group, 'coordinates');
    const host = HOST_RULES[group];

    return [
        `about\t${description} Components: ${components.map((component) => component.name).join(', ')}`,
        `rules\t${host === undefined ? rules : `${rules} ${host}`}`,
        'prints\tcomponent\tname\tprops\tdescription\tone row per component; a prop that ends in ? is optional, - is none',
        ...components.map((component) => `component\t${component.name}\t${component.props.join(', ') || '-'}\t${component.description}`),
        ...components.flatMap((component) => (component.example === undefined ? [] : [`example\t${component.example}`]))
    ];
}

/* The live data extensions add, which every group may draw: the name a block reads it under, its arguments and what it is. */
function sourceLines(sources: readonly { name: string; description: string; parameters?: object }[]): string[] {
    if (sources.length === 0) {
        return [];
    }

    return [
        `prints\tsource\tname\targs as JSON Schema\tdescription\tlive data of an extension, read as $rows = @Query("${EXTENSION_UI_SOURCE}", {source: "<name>", args: {...}})`,
        ...sources.map(
            (source) => `source\t${source.name}\t${source.parameters === undefined ? '-' : JSON.stringify(source.parameters)}\t${source.description}`
        )
    ];
}

const uiCatalog = defineTool('ui', {
    name: 'ui_catalog',
    description: 'Lists the UI components a visual may use, one group at a time.',
    annotations: { readOnly: true },
    audience: 'chat',
    input: z.object({ group: z.enum(GROUP_NAMES, { error: `ui_catalog needs group, one of ${GROUP_NAMES.join(', ')}` }) }),
    run: async (input, call) => [...groupLines(input.group), ...sourceLines((await call.host.uiSources?.refresh(true)) ?? [])]
});

/* Named as the usage counter its calls add to, which the usage report and the client know. */
export const uiToolkit = defineToolkit('ui', [uiCatalog]);
