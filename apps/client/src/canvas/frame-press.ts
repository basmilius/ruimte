import type { NodeKind } from '@ruimte/contracts';

/*
 * Whether a press on a node's header or on the frame around its body hands the keyboard to what the
 * node holds. A header is a title bar: pressing it picks the node up and puts the keyboard in its
 * content, so a terminal types and a simulator reads the trackpad without a second press. A group
 * holds nothing to type in, and a press that adds to the selection is about moving several nodes.
 */
export const framePressHandsKeyboard = (kind: NodeKind | 'unknown' | undefined, additive: boolean): boolean =>
    kind !== undefined && kind !== 'group' && !additive;
