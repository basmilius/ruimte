import { UI_GROUPS, type UiGroupName } from '@adecore/intelligent-ui';
import { uiGroupReference } from '@adecore/intelligent-ui/text';
import { z } from 'zod';
import { defineTool, defineToolkit } from './tool.ts';

const GROUP_NAMES = Object.keys(UI_GROUPS) as [UiGroupName, ...UiGroupName[]];

/* `Name: description. Props: a, b?.` as the catalog prints one component; a component without props ends at its description. */
const COMPONENT_LINE = /^(\w+): (.*?)(?: Props: (.*)\.)?$/;

/* Host guidance supplements the catalog's group rules. */
const HOST_RULES: Partial<Record<UiGroupName, string>> = {
    data: 'Stat value and previous take numbers, e.g. value={42}; unit is a suffix. Use EntityList with Entry children for formatted text such as "21 min 38 sec".',
    content:
        'To show an image or model file of your own, attach it with chat_attach and its path, which prints the id for attachment="<id>" on Image, Gallery and Compare, or on Model for a binary glTF, USDZ or STL',
    places: 'Ruimte does not look up addresses, so give lat and lon for every Place; an address may still be given as text, but a Place with only an address is not placed on the map'
};

function componentLine(line: string): string {
    const [, name, description, props] = COMPONENT_LINE.exec(line) ?? [];

    return name === undefined ? `component\t${line}` : `component\t${name}\t${props ?? '-'}\t${description}`;
}

function componentNames(group: UiGroupName): string[] {
    return uiGroupReference(group)
        .split('\n')
        .slice(2)
        .map((line) => line.split(':')[0] ?? line);
}

/* What the group is for, its rules, then a line per component with its props and what it is. */
function groupLines(group: UiGroupName): string[] {
    const [, rules = '', ...components] = uiGroupReference(group).split('\n');
    const host = HOST_RULES[group];

    return [
        `about\t${UI_GROUPS[group].description} Components: ${componentNames(group).join(', ')}`,
        `rules\t${host === undefined ? rules : `${rules} ${host}`}`,
        'prints\tcomponent\tname\tprops\tdescription\tone row per component; a prop that ends in ? is optional, - is none',
        ...components.map(componentLine),
        ...(group === 'data'
            ? ['example\t<EntityList><Entry label="ci">21 min 38 sec</Entry><Entry label="far-future-clock">16 min 46 sec</Entry></EntityList>']
            : [])
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
