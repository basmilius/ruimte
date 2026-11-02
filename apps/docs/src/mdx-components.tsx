import type { MDXComponents } from 'mdx/types';
import { Anchor, Heading2, Heading3, Pre } from '@/components/MdxElements';

const components: MDXComponents = { h2: Heading2, h3: Heading3, pre: Pre, a: Anchor };

export function useMDXComponents(): MDXComponents {
    return components;
}
