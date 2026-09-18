import { z } from 'zod';

/*
 * The faces anything a person places by hand is written in: the text in a drawing and a label on a
 * canvas. It lives apart from both so neither has to import the other, and `styles.css` maps every
 * name to a stack.
 */
export const DrawingFontSchema = z.enum(['hand', 'sans', 'mono']);
export type DrawingFont = z.infer<typeof DrawingFontSchema>;
