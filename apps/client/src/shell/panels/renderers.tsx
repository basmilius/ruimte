import { FileQuestion } from 'lucide-react';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

export interface FileRendererProps {
    /* Absolute on the daemon's machine. */
    path: string;
    name: string;
}

export interface FileRenderer {
    id: string;
    /* Whether this renderer takes the file, decided on its name alone; the bytes come later. */
    match(name: string): boolean;
    render(props: FileRendererProps): React.JSX.Element;
}

/*
 * What draws a file in the viewer, tried in order. Reading a file is a step of its own (`fs.read`
 * with a binary sniff), so today every file lands on the fallback below; shiki, the chat's markdown
 * component and an image tag register here without the viewer changing.
 */
export const FILE_RENDERERS: readonly FileRenderer[] = [];

export const renderFile = (props: FileRendererProps): React.JSX.Element =>
    FILE_RENDERERS.find((renderer) => renderer.match(props.name))?.render(props) ?? (
        <EmptyState icon={<Icon icon={FileQuestion} size={20} />}>
            {props.name} is open. Reading files comes next; the viewer has nothing to draw yet.
        </EmptyState>
    );
