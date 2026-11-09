import type { ComponentType } from 'react';
import { createRegistry } from './create-registry';

export interface NodeBodyProps {
    id: string;
    /* The node is on screen (or held a moment after), so a body may run; off screen it draws its plate. */
    live: boolean;
    /* Zoomed in enough that a body reads as it is, or maximized; below that a node draws its plate. */
    renderBody: boolean;
    focused: boolean;
    /* The node is the one the canvas has its body focus on, whether or not the window has the keyboard. */
    active: boolean;
    /* A chat or terminal runs its surface only while it is read, zoomed in on, maximized or active; any other node is always so. */
    sessionLive: boolean;
}

export interface NodeHeaderProps {
    id: string;
    /* The chat the node's pills speak for: the node itself, or the chat a design shows. */
    chatId: string;
    narrow: boolean;
    renaming: boolean;
}

/*
 * One kind of node on a canvas, registered by the feature that owns it: the frame looks the kind up
 * and draws what it names, so a new kind touches its own folder and the wiring, never the frame.
 * An unknown kind has no definition and draws the plate for a newer Ruimte's node.
 */
export interface NodeKindDefinition {
    readonly id: string;
    readonly body: ComponentType<NodeBodyProps>;
    /* The header holds a place for the controls of the file or the view in the body: a group of buttons or a row. */
    readonly controls?: 'buttons' | 'row';
    /* Beside the title, before what every node shows. */
    readonly afterTitle?: ComponentType<NodeHeaderProps>;
    /* After the pills every node shows, before its status. */
    readonly beforeStatus?: ComponentType<NodeHeaderProps>;
    /* At the end of the header, before the slots of extensions. */
    readonly toolbar?: ComponentType<NodeHeaderProps>;
    readonly strip?: ComponentType<{ id: string }>;
    readonly bodyClass?: string;
}

export const nodeKindRegistry = createRegistry<NodeKindDefinition>('node kind');
