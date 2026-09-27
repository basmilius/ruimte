import type { ModelInfo, ModelOptionDescriptor, ModelSelection } from '@ruimte/agent-contracts';

type OptionValues = ModelSelection['options'];

const fits = (option: ModelOptionDescriptor, value: string | boolean | undefined): value is string | boolean =>
    option.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string' && option.choices.some((choice) => choice.id === value);

/* What an option runs at: the value picked, else the model's own default. A value the model does not offer counts as unpicked. */
export const optionValue = (option: ModelOptionDescriptor, options: OptionValues): string | boolean => {
    const picked = options[option.id];
    if (fits(option, picked)) {
        return picked;
    }
    return option.type === 'boolean' ? option.defaultValue : option.defaultChoice;
};

/* The picked options that `model` offers as well, so switching models keeps an effort the next one also has. */
export const carryOptions = (options: OptionValues, model: ModelInfo | undefined): OptionValues =>
    Object.fromEntries((model?.options ?? []).filter((option) => fits(option, options[option.id])).map((option) => [option.id, options[option.id]!]));
