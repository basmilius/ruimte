import { UI_GROUPS, uiGroupDescription, type UiGroupName } from '@adecore/intelligent-ui';
import { z } from 'zod';
import { defineTool, defineToolkit } from './tool.ts';

const GROUP_NAMES = Object.keys(UI_GROUPS) as [UiGroupName, ...UiGroupName[]];

/* Host guidance supplements the catalog's group rules. */
const HOST_RULES: Partial<Record<UiGroupName, string>> = {
    data: 'Stat value and previous take numbers, e.g. value={42}; unit is a suffix. Use EntityList with Entry children for formatted text such as "21 min 38 sec".',
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

const uiCatalog = defineTool('ui', {
    name: 'ui_catalog',
    description: 'Lists the UI components a visual may use, one group at a time.',
    annotations: { readOnly: true },
    audience: 'chat',
    input: z.object({ group: z.enum(GROUP_NAMES, { error: `ui_catalog needs group, one of ${GROUP_NAMES.join(', ')}` }) }),
    run: async (input) => groupLines(input.group)
});

/* Named as the usage counter its calls add to, which the usage report and the client know. */
export const uiToolkit = defineToolkit('ui', [uiCatalog]);
