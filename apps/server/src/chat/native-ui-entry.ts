import { nativeUiJson } from './native-ui';

(globalThis as typeof globalThis & { ruimteEvaluateUi: (json: string) => string }).ruimteEvaluateUi = nativeUiJson;
