import type { ProjectView } from '@ruimte/contracts';
import { ExtensionViewKindBody } from '@/extensions/ExtensionViewKindBody';
import { viewKind } from '@/registry/view-kinds';
import { extensionKeyOf } from '@/state/extension-registry';

type UnknownView = Extract<ProjectView, { kind: 'unknown' }>;

/* A view of an extension is a view of a kind this Ruimte does not know, with the key of the contribution that draws it. */
export const EXTENSION_VIEW_KIND = viewKind({
    id: 'extension',
    owns: (view): view is UnknownView => view.kind === 'unknown' && extensionKeyOf(view.raw) !== null,
    body: ExtensionViewKindBody
});
