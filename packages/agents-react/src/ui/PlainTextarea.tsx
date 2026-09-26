import type { TextareaProps } from '../host';

/* The field a written answer goes in when the app brings no dictation of its own. */
export function PlainTextarea({ buttonClassName: _buttonClassName, ...props }: TextareaProps) {
    return <textarea {...props} />;
}
