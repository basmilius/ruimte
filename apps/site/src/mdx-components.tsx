import type { MDXComponents } from 'mdx/types';
import { Anchor, Heading2, Heading3, Pre } from '@/components/docs/MdxElements';
import { Note } from '@/components/docs/Note';
import { Shortcut } from '@/components/docs/Shortcut';

const components: MDXComponents = {
    h2: Heading2,
    h3: Heading3,
    pre: Pre,
    a: Anchor,
    Note,
    Shortcut
};

export function useMDXComponents(): MDXComponents {
    return components;
}
