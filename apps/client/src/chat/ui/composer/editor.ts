import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { Annotation, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

/* Marks a transaction that brings the editor in line with a value set from outside, so it is not reported back. */
export const externalChange = Annotation.define<boolean>();

/*
 * What every composer editor carries. The standard keymap rather than the default one: the default
 * adds code editor commands (move a line, indent, select the syntax parent) on keys a prompt box
 * has no business taking.
 */
export const composerEditorExtensions = (): Extension => [history(), keymap.of([...standardKeymap, ...historyKeymap]), EditorView.lineWrapping];
