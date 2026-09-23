// Only the registrations: a language's service and its worker load once a model of that language opens.
import { cssDefaults, lessDefaults, scssDefaults } from 'monaco-editor/languages/features/css/register';
import 'monaco-editor/languages/features/html/register';
import { jsonDefaults } from 'monaco-editor/languages/features/json/register';
import {
    javascriptDefaults,
    JsxEmit,
    ModuleKind,
    ModuleResolutionKind,
    ScriptTarget,
    typescriptDefaults
} from 'monaco-editor/languages/features/typescript/register';
// Brackets, comments and indentation for the serviced languages. Their Monarch tokenizers never run: a Shiki provider is registered before a model takes the language.
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/html/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/less/register';
import 'monaco-editor/languages/definitions/scss/register';
import 'monaco-editor/languages/definitions/typescript/register';

// `ts.ModuleDetectionKind.Force`, which Monaco's enums leave out: every file is a module, so one open file's globals never reach another.
const MODULE_DETECTION_FORCE = 3;

/*
 * The services know the one file and nothing around it: no `node_modules`, no tsconfig, no other file.
 * So nothing is reported that only the project could settle, an import it cannot resolve above all,
 * and nothing is fetched to fill the gap. Syntax errors are the file's own and stay.
 */
export const configureLanguageServices = (): void => {
    const compilerOptions = {
        target: ScriptTarget.Latest,
        module: ModuleKind.ESNext,
        moduleResolution: ModuleResolutionKind.NodeJs,
        moduleDetection: MODULE_DETECTION_FORCE,
        jsx: JsxEmit.Preserve,
        allowNonTsExtensions: true
    };
    const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true };
    typescriptDefaults.setCompilerOptions(compilerOptions);
    javascriptDefaults.setCompilerOptions({ ...compilerOptions, allowJs: true });
    typescriptDefaults.setDiagnosticsOptions(diagnostics);
    javascriptDefaults.setDiagnosticsOptions(diagnostics);

    jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true,
        comments: 'ignore',
        trailingCommas: 'warning',
        schemas: [],
        enableSchemaRequest: false,
        schemaRequest: 'ignore',
        schemaValidation: 'ignore'
    });
    // The JSON service brings a tokenizer of its own, registered as it starts, which would draw over Shiki's.
    jsonDefaults.setModeConfiguration({ ...jsonDefaults.modeConfiguration, tokens: false });

    // An at-rule such as Tailwind's `@theme` is the project's, which the service cannot know; the type leaves the setting out.
    for (const defaults of [cssDefaults, scssDefaults, lessDefaults]) {
        const lint = { ...defaults.options.lint, unknownAtRules: 'ignore' as const };
        defaults.setOptions({ ...defaults.options, lint });
    }
};
