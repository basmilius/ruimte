import type { ModelOptionDescriptor, ModelSelection } from '@ruimte/agent-contracts';
import { Segmented, Switch, Select } from '@basmilius/desktop-ui';
import { optionValue } from './model-options';

// Up to this many choices read at a glance side by side; more go into a menu.
const MAX_SEGMENTS = 3;

// The item `defaultLabel` adds; a choice id is never empty.
const MODEL_DEFAULT = '';

type ModelOptionControlProps = {
    option: ModelOptionDescriptor;
    /* The selection's options, of which this control reads and writes one. */
    options: ModelSelection['options'];
    /* `compact` beside a model picker in a form, `row` as the control of a settings row. */
    layout?: 'compact' | 'row';
    disabled?: boolean;
} & (
    | { defaultLabel?: undefined; onChange(value: string | boolean): void }
    /* Adds an item that leaves the choice to the model, answered as `undefined`. A boolean has no room for it and ignores it. */
    | { defaultLabel: string; onChange(value: string | boolean | undefined): void }
);

/*
 * One of a model's own knobs outside a chat, such as effort in a form. The composer draws the same
 * descriptors as menu items (`RunSettings`), since there they sit in a menu.
 */
export function ModelOptionControl(props: ModelOptionControlProps) {
    const { option, options, layout = 'compact', disabled } = props;
    if (option.type === 'boolean') {
        return <Switch checked={optionValue(option, options) === true} label={option.label} disabled={disabled} onCheckedChange={props.onChange} />;
    }
    const picked = props.defaultLabel !== undefined && options[option.id] === undefined ? MODEL_DEFAULT : String(optionValue(option, options));
    const choices = [
        ...(props.defaultLabel !== undefined ? [{ id: MODEL_DEFAULT, label: props.defaultLabel, description: undefined }] : []),
        ...option.choices
    ];
    const choose = (id: string): void => {
        if (props.defaultLabel !== undefined) {
            props.onChange(id === MODEL_DEFAULT ? undefined : id);
            return;
        }
        props.onChange(id);
    };
    if (layout === 'row' && choices.length <= MAX_SEGMENTS) {
        return (
            <Segmented
                value={picked}
                label={option.label}
                disabled={disabled}
                options={choices.map((choice) => ({ id: choice.id, label: choice.label }))}
                onValueChange={choose}
            />
        );
    }
    return (
        <Select
            value={picked}
            label={option.label}
            size={layout === 'compact' ? 'sm' : 'md'}
            variant={layout === 'compact' ? 'ghost' : 'outlined'}
            align={layout === 'row' ? 'end' : 'start'}
            disabled={disabled}
            items={choices.map((choice) => ({ value: choice.id, label: choice.label, description: choice.description }))}
            onValueChange={choose}
        />
    );
}
