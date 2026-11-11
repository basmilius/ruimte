// @bun
// Generated from apps/server/src/extensions/test-runtime.ts by apps/server/scripts/generate-extension-runtimes.ts. Do not edit.
// apps/server/src/extensions/test-runtime.ts
var {plugin } = globalThis.Bun;
import { afterAll, afterEach } from "bun:test";

// apps/server/src/extensions/test-react.ts
import { realpathSync } from "fs";
import { createRequire } from "module";
import { join } from "path";
var nodeContext = null;
function fromProject(name) {
  try {
    return createRequire(join(process.cwd(), "package.json"))(name);
  } catch {
    throw new Error(`This test needs ${name}, which this project does not have: bun add -d ${name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]}`);
  }
}
function besideExtension(name) {
  const extension = join(process.cwd(), "node_modules", "@ruimte", "extension", "package.json");
  try {
    return createRequire(realpathSync(extension))(name);
  } catch {
    return fromProject(name);
  }
}
function formatModule() {
  return besideExtension("@adecore/ui/format");
}
function uiModule() {
  const { SettingsRow, SettingsSection } = besideExtension("@adecore/ui/settings");
  return { ...besideExtension("@adecore/ui"), SettingsRow, SettingsSection };
}
function chartsModule() {
  return besideExtension("@adecore/charts");
}
function agentsUiModule() {
  return besideExtension("@adecore/agents-react/chat/ui");
}
function react() {
  return fromProject("react");
}
function nodeContextOf(module) {
  nodeContext ??= module.createContext(null);
  return nodeContext;
}

// apps/server/src/extensions/test-dom.ts
var MAX_TURNS = 200;
var SUSPENDED = "ruimte-suspended";
var PRESSABLE = 'button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"], summary, label';
var mounted = new Set;
async function step(module, work) {
  const scope = globalThis;
  const before = scope.IS_REACT_ACT_ENVIRONMENT;
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await module.act(async () => {
      await work();
    });
  } finally {
    scope.IS_REACT_ACT_ENVIRONMENT = before;
  }
}
function turn(module) {
  return step(module, () => new Promise((resolve) => setImmediate(resolve)));
}
function unmountAll() {
  for (const unmount of [...mounted]) {
    unmount();
  }
}
function textOf(element) {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}
function findIn(container, text, preferred) {
  const saying = (element) => textOf(element).includes(text) || element.getAttribute("aria-label") === text;
  const among = [...container.querySelectorAll(preferred)].filter(saying);
  if (among.length > 0) {
    return among.at(-1) ?? null;
  }
  const all = [...container.querySelectorAll("*")].filter(saying);
  return all.find((element) => ![...element.children].some(saying)) ?? null;
}
function fieldIn(container, name) {
  const fields = [...container.querySelectorAll("input, textarea")];
  const labelled = fields.find((field) => field.placeholder === name || field.name === name || field.getAttribute("aria-label") === name || field.id !== "" && textOf(container.querySelector(`label[for="${field.id}"]`) ?? document.createElement("i")) === name || field.closest("label") !== null && textOf(field.closest("label")).includes(name));
  return labelled ?? null;
}
async function settle(module, check, failure) {
  let last = null;
  for (let turns = 0;turns < MAX_TURNS; turns++) {
    try {
      if (check() !== false) {
        return;
      }
      last = null;
    } catch (e) {
      last = e;
    }
    await turn(module);
  }
  throw last instanceof Error ? last : new Error(failure());
}
function needsPage() {
  if (typeof document === "undefined") {
    throw new Error("render draws into a page: name the test file *.dom.test.tsx, and ruimte extension test gives it one");
  }
}
async function drawable(target, options) {
  if ("frame" in target) {
    throw new Error("A frame surface runs in its own page in Ruimte; render draws component surfaces");
  }
  if (typeof target === "object" && "component" in target && typeof target.component === "function") {
    const loaded = (await target.component()).default;
    return [loaded, { params: options.params, ...options.context === undefined ? {} : { context: options.context }, ...options.props }];
  }
  return [
    target,
    {
      ...options.params === undefined ? {} : { params: options.params },
      ...options.context === undefined ? {} : { context: options.context },
      ...options.props
    }
  ];
}
async function render(target, options = {}) {
  needsPage();
  const module = react();
  const { createRoot } = fromProject("react-dom/client");
  const [component, props] = await drawable(target, options);
  const container = document.createElement("div");
  const failure = { error: null };
  const drawn = { committed: false };
  const Committed = () => {
    module.useEffect(() => {
      drawn.committed = true;
    });
    return null;
  };

  class Boundary extends module.Component {
    static getDerivedStateFromError(error) {
      failure.error = error;
      return { failed: true };
    }
    render() {
      return this.state?.failed === true ? null : this.props.children;
    }
  }
  document.body.append(container);
  const root = createRoot(container, { onCaughtError: () => {
    return;
  } });
  const unmount = () => {
    if (mounted.delete(unmount)) {
      root.unmount();
      container.remove();
    }
  };
  const after = async () => {
    await turn(module);
    await settle(module, () => failure.error !== null || container.querySelector(SUSPENDED) === null, () => `It is still waiting for what it suspends on, after ${MAX_TURNS} turns`);
    if (failure.error !== null) {
      const { error } = failure;
      failure.error = null;
      throw error;
    }
  };
  mounted.add(unmount);
  try {
    await step(module, () => root.render(module.createElement(Boundary, null, module.createElement(module.Suspense, { fallback: module.createElement(SUSPENDED) }, module.createElement(nodeContextOf(module).Provider, { value: options.node ?? null }, module.createElement(component, props)), module.createElement(Committed)))));
    await settle(module, () => failure.error !== null || drawn.committed, () => `It is still waiting for what it suspends on, after ${MAX_TURNS} turns`);
    await after();
  } catch (e) {
    unmount();
    throw e;
  }
  return {
    container,
    text: () => textOf(container),
    find: (text) => findIn(container, text, PRESSABLE),
    async click(target) {
      const element = typeof target === "string" ? findIn(container, target, PRESSABLE) : target;
      if (element === null) {
        throw new Error(`Nothing says ${target} here. The page says: ${textOf(container)}`);
      }
      await step(module, () => element.click());
      await after();
    },
    async type(target, text) {
      const field = typeof target === "string" ? fieldIn(container, target) : target;
      if (field === null || !("value" in field)) {
        throw new Error(`No field ${String(target)} here`);
      }
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      await step(module, () => {
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await after();
    },
    until: (check) => settle(module, check, () => `Still not so after ${MAX_TURNS} turns. The page says: ${textOf(container)}`),
    unmount
  };
}

// apps/server/src/extensions/test-hosts.ts
import { existsSync } from "fs";
import { join as join5, resolve as resolve2 } from "path";

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}

class Cached {
  constructor(getter) {
    this._getter = getter;
    this._value = undefined;
  }
  get value() {
    const getter = this._getter;
    if (getter !== undefined) {
      this._value = getter();
      this._getter = undefined;
    }
    return this._value;
  }
}
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== undefined && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : undefined;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : undefined;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({ type: "nonoptional", innerType: value }));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a;
  for (let i = start;i < issues.length; i++) {
    (_a = issues[i]).schema ?? (_a.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config) {
  var _a;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a = iss).schema ?? (_a.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : undefined;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0;i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? undefined : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = undefined;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: undefined };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: undefined, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition;
      }
      try {
        return new Definition;
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition;
}
function $constructor(name, initializer, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = new Set;
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && new WeakSet;
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = undefined;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    if (initialized) {
      const own = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto = _.prototype;
    for (const k in proto) {
      if (!Object.prototype.hasOwnProperty.call(proto, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = undefined;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: undefined, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = undefined;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, undefined, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node = curr[el];
            if (terminal) {
              node._errors.push(mapper(issue));
            }
            curr = node;
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError;
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error;
  return {
    success: false,
    get error() {
      if (!error) {
        error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = undefined;
        ctx = undefined;
      }
      return error;
    },
    set error(e) {
      error = e;
      issues = undefined;
      ctx = undefined;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = (schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== undefined) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === undefined)
      return false;
  }
  return validateFallback(schema, value, _ctx);
};
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
var _encode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _encodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== undefined;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join(`
`)}
};`);
    return factory(...Object.values(this.closed));
  }
}

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {}
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var URL_BAD_FORMAT = 1;
var URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = validateURL(trimmed, def);
      if (url === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== undefined && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === undefined ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== undefined && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === undefined) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, new Set);
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== undefined)
          propValues[key].add(undefined);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== undefined;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== undefined) ? "optional" : undefined);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
function discriminatorMap(def) {
  const map = new Map;
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0)
      throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
    for (const value of values) {
      if (map.has(value)) {
        if (value !== undefined)
          throw new Error(`Duplicate discriminator value "${String(value)}"`);
        map.set(value, null);
      } else {
        map.set(value, option);
      }
    }
  }
  return map;
}
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazyInternal(inst, "propValues", (zod) => {
    const propValues = {};
    let undefinedCount = 0;
    for (const option of zod.def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
      if (pv[zod.def.discriminator]?.has(undefined))
        undefinedCount++;
      for (const [k, v] of Object.entries(pv)) {
        if (!Object.prototype.hasOwnProperty.call(propValues, k)) {
          assignProp(propValues, k, new Set);
        }
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    if (!zod.def.unionFallback && undefinedCount > 1)
      propValues[zod.def.discriminator]?.delete(undefined);
    return propValues;
  });
  def.options.forEach((option, i) => {
    const propShape = rawShape(option._zod.def);
    if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) {
      throw new Error(`Invalid discriminated union option at index "${i}"`);
    }
  });
  const disc = cached(() => discriminatorMap(def));
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const value = input?.[def.discriminator];
    const opt = disc.value.get(value);
    if (opt && (value !== undefined || ctx.direction !== "backward")) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  const keyIssues = new Map;
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output) => {
        payload.value = output;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? undefined : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? new Set([...values, undefined]) : undefined;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === undefined) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result) => handleOptionalResult(payload, result));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? new Set([...zod.def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleDefaultResult(result, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleNonOptionalResult(result, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleCatchResult(payload, result, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/memoizer.js
class $ZodCyclicError extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
}
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap;
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached = recursive.get(inst);
  if (cached !== undefined)
    return cached ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge(raw ? shape(raw, true) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : undefined);
      merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    case "template_literal":
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle2(inst, result);
}
function settle2(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = new WeakMap;
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = undefined;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError;
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === undefined) {
          const walked = isRecursive(inst, new Set, false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: new WeakMap, backEdges: undefined };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = new WeakSet);
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = undefined;
        const entry = open.length > depth ? open.pop() : undefined;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== undefined && isRef(value) && backEdges.has(value);
}
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        const expected = getTypeName(issue.expected);
        const receivedType = parsedType(issue.input);
        const received = getTypeName(receivedType, issue.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
      case "too_big": {
        const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
        const sizing = getSizing(issue.origin);
        if (sizing)
          return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
        const sizing = getSizing(issue.origin);
        if (sizing) {
          return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue.origin}`;
      case "invalid_union":
        if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
          const opts = issue.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/registries.js
var _a2;
class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    sharedDefsExtractedFor: undefined,
    sharedEmitDoneFor: undefined,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? undefined
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === undefined || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = undefined;
  ctx.sharedEmitDoneFor = undefined;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    assignProps(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) {
      delete schema[key];
    }
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== undefined)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === undefined || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members) {
  const objects = [];
  for (const member of members) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required = new Set;
  for (const object of objects) {
    for (const key in object.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === undefined)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object.required ?? [])
      required.add(key);
  }
  const folded = { type: "object", properties };
  if (required.size)
    folded.required = [...required];
  if (objects.every((object) => object.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object of objects) {
      const constraint = undeclaredConstraint(object);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
    if (Object.keys(union).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union);
    const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else {
        assignProps(schema, refSchema);
      }
      assignProps(schema, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = new Map;
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === undefined || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === undefined || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = new Set);
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== undefined)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== undefined)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== undefined)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== undefined)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== undefined)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== undefined) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var exactPatterns = new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = new Set;
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== undefined)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === undefined : field._zod.optout === undefined) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
var pendingRecords = new WeakMap;
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue) => {
    self.issues.push(issue);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues) => {
    self.issues.push(...issues);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, undefined, {
  Parent: Error
});

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/.bun/zod@4.6.7/node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta) {
    reg.add(this, meta);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(_overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(undefined).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  get "~standard"() {
    return hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  },
  parse: function _parse(data, params) {
    return parse2(this, data, params, { callee: _parse });
  },
  parseAsync: async function _parseAsync(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode(data, params) {
    return encode(this, data, params, { callee: _encode });
  },
  decode: function _decode(data, params) {
    return decode(this, data, params, { callee: _decode });
  },
  encodeAsync: async function _encodeAsync(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync });
  },
  decodeAsync: async function _decodeAsync(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  get description() {
    return globalRegistry.get(this)?.description;
  },
  get _def() {
    return this._zod.def;
  }
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
}, /* @__PURE__ */ derived({
  format: (inst) => aggregateChecks(inst).format ?? null,
  minLength: (inst) => aggregateChecks(inst).minimum ?? null,
  maxLength: (inst) => aggregateChecks(inst).maximum ?? null
}, {
  regex(...args) {
    return this.check(_regex(...args));
  },
  includes(...args) {
    return this.check(_includes(...args));
  },
  startsWith(...args) {
    return this.check(_startsWith(...args));
  },
  endsWith(...args) {
    return this.check(_endsWith(...args));
  },
  min(...args) {
    return this.check(_minLength(...args));
  },
  max(...args) {
    return this.check(_maxLength(...args));
  },
  length(...args) {
    return this.check(_length(...args));
  },
  nonempty(...args) {
    return this.check(_minLength(1, ...args));
  },
  lowercase(params) {
    return this.check(_lowercase(params));
  },
  uppercase(params) {
    return this.check(_uppercase(params));
  },
  trim() {
    return this.check(_trim());
  },
  normalize(...args) {
    return this.check(_normalize(...args));
  },
  toLowerCase() {
    return this.check(_toLowerCase());
  },
  toUpperCase() {
    return this.check(_toUpperCase());
  },
  slugify() {
    return this.check(_slugify());
  }
}));
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base642(params) {
  return _base64(ZodBase64, params);
}
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  inst.isFinite = true;
}, /* @__PURE__ */ derived({
  minValue: (inst) => {
    const { minimum, exclusiveMinimum } = aggregateChecks(inst);
    return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
  },
  maxValue: (inst) => {
    const { maximum, exclusiveMaximum } = aggregateChecks(inst);
    return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
  },
  isInt: (inst) => {
    const { isInt, multipleOf } = aggregateChecks(inst);
    return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
  },
  format: (inst) => aggregateChecks(inst).format ?? null
}, {
  gt(value, params) {
    return this.check(_gt(value, params));
  },
  gte(value, params) {
    return this.check(_gte(value, params));
  },
  min(value, params) {
    return this.check(_gte(value, params));
  },
  lt(value, params) {
    return this.check(_lt(value, params));
  },
  lte(value, params) {
    return this.check(_lte(value, params));
  },
  max(value, params) {
    return this.check(_lte(value, params));
  },
  int(params) {
    return this.check(int(params));
  },
  safe(params) {
    return this.check(int(params));
  },
  positive(params) {
    return this.check(_gt(0, params));
  },
  nonnegative(params) {
    return this.check(_gte(0, params));
  },
  negative(params) {
    return this.check(_lt(0, params));
  },
  nonpositive(params) {
    return this.check(_lte(0, params));
  },
  multipleOf(value, params) {
    return this.check(_multipleOf(value, params));
  },
  step(value, params) {
    return this.check(_multipleOf(value, params));
  },
  finite() {
    return this;
  }
}));
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(mergeDefs(this._zod.def, { catchall: undefined }));
  },
  extend(incoming) {
    return extend(this, incoming);
  },
  safeExtend(incoming) {
    return safeExtend(this, incoming);
  },
  merge(other) {
    return merge(this, other);
  },
  pick(mask) {
    return pick(this, mask);
  },
  omit(mask) {
    return omit(this, mask);
  },
  partial(...args) {
    return partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output) => {
        payload.value = output;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
// packages/contracts/src/artifact.ts
var ARTIFACT_KINDS = ["report", "image", "build", "export", "recording", "page"];
var KnownArtifactKindSchema = _enum(ARTIFACT_KINDS);
var ArtifactKindSchema = string2().min(1).max(32).regex(/^[a-z][a-z0-9-]*$/);
var ARTIFACT_LIMITS = {
  versionBytes: 2 * 1024 * 1024 * 1024,
  filesPerVersion: 64,
  titleLength: 200,
  fileNameLength: 255,
  uploadChunkBytes: 8 * 1024 * 1024
};
var ArtifactIdSchema = string2().min(1).max(64);
var ArtifactVersionIdSchema = string2().min(1).max(64);
var Sha256Schema = string2().min(1).max(128);
var ARTIFACT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
var ArtifactKeySchema = string2().regex(ARTIFACT_KEY_PATTERN);
var ArtifactRequestIdSchema = string2().regex(/^[A-Za-z0-9_-]{1,64}$/);
var ArtifactFileSchema = object({
  name: string2().min(1).max(ARTIFACT_LIMITS.fileNameLength),
  mime: string2().min(1),
  size: number2().int().nonnegative(),
  sha256: Sha256Schema
});
var ArtifactProvenanceSchema = object({
  maker: _enum(["agent", "person", "routine"]),
  machineId: string2().min(1),
  chatId: string2().min(1).optional(),
  turnId: string2().min(1).optional(),
  taskId: string2().min(1).optional(),
  nodeId: string2().min(1).optional(),
  launchId: string2().min(1).optional(),
  routineId: string2().min(1).optional(),
  runId: string2().min(1).optional(),
  agent: string2().min(1).max(64).optional(),
  model: string2().min(1).max(200).optional()
});
var ArtifactOriginSchema = object({
  machineId: string2().min(1),
  artifactId: ArtifactIdSchema,
  versionId: ArtifactVersionIdSchema,
  provenance: ArtifactProvenanceSchema,
  hashes: array(Sha256Schema)
});
var ArtifactVersionSchema = object({
  versionId: ArtifactVersionIdSchema,
  number: number2().int().positive(),
  createdAt: number2().int().nonnegative(),
  files: array(ArtifactFileSchema).min(1).max(ARTIFACT_LIMITS.filesPerVersion),
  bytes: number2().int().nonnegative(),
  provenance: ArtifactProvenanceSchema,
  copiedTo: array(string2().min(1)),
  origin: ArtifactOriginSchema.optional()
});
var ArtifactSchema = object({
  artifactId: ArtifactIdSchema,
  projectId: string2().min(1),
  projectName: string2(),
  title: string2().min(1).max(ARTIFACT_LIMITS.titleLength),
  kind: ArtifactKindSchema,
  key: ArtifactKeySchema.optional(),
  createdAt: number2().int().nonnegative()
});
var ArtifactSummarySchema = ArtifactSchema.extend({
  latest: ArtifactVersionSchema,
  versionCount: number2().int().positive(),
  totalBytes: number2().int().nonnegative()
});
var ArtifactListPayloadSchema = object({ projectId: string2().min(1).optional(), chatId: string2().min(1).optional() });
var ArtifactListResultSchema = object({ artifacts: array(ArtifactSummarySchema) });
var ArtifactGetPayloadSchema = object({ artifactId: ArtifactIdSchema });
var ArtifactGetResultSchema = object({
  artifact: ArtifactSchema,
  versions: array(ArtifactVersionSchema).min(1),
  chatPresent: boolean2()
});
var ArtifactChangedEventSchema = object({
  artifactId: ArtifactIdSchema,
  projectId: string2().min(1),
  removed: boolean2().optional()
});
var ArtifactSaveSourceSchema = discriminatedUnion("kind", [
  object({ kind: literal("visual"), chatId: string2().min(1), visualId: string2().min(1) }),
  object({ kind: literal("attachment"), chatId: string2().min(1), attachmentId: string2().min(1) }),
  object({ kind: literal("image"), chatId: string2().min(1), path: string2().min(1).max(4096) })
]);
var ArtifactSavePayloadSchema = object({
  projectId: string2().min(1),
  title: string2().trim().min(1).max(ARTIFACT_LIMITS.titleLength).optional(),
  kind: KnownArtifactKindSchema.optional(),
  key: ArtifactKeySchema.optional(),
  requestId: ArtifactRequestIdSchema,
  source: ArtifactSaveSourceSchema
});
var ArtifactSaveResultSchema = object({ artifactId: ArtifactIdSchema, versionId: ArtifactVersionIdSchema });
var ArtifactSaveFolderPayloadSchema = object({
  projectId: string2().min(1),
  path: string2().min(1).max(4096),
  title: string2().trim().min(1).max(ARTIFACT_LIMITS.titleLength),
  kind: KnownArtifactKindSchema.optional(),
  key: ArtifactKeySchema.optional(),
  requestId: ArtifactRequestIdSchema
});
var ArtifactCopyToProjectPayloadSchema = object({
  artifactId: ArtifactIdSchema,
  versionId: ArtifactVersionIdSchema,
  projectId: string2().min(1),
  path: string2().min(1).max(4096)
});
var ArtifactCopyToProjectResultSchema = object({ paths: array(string2().min(1)) });
var ArtifactProjectStorageSchema = object({
  projectId: string2().min(1),
  projectName: string2(),
  artifacts: number2().int().nonnegative(),
  versions: number2().int().nonnegative(),
  bytes: number2().int().nonnegative()
});
var ArtifactStorageResultSchema = object({
  projects: array(ArtifactProjectStorageSchema),
  total: object({ artifacts: number2().int().nonnegative(), versions: number2().int().nonnegative(), bytes: number2().int().nonnegative() }),
  disk: object({ free: number2().int().nonnegative(), size: number2().int().nonnegative() }).nullable()
});
var ArtifactVersionRefSchema = object({ artifactId: ArtifactIdSchema, versionId: ArtifactVersionIdSchema });
var ArtifactCleanupPayloadSchema = discriminatedUnion("mode", [
  object({ mode: literal("preview") }),
  object({ mode: literal("confirm"), versions: array(ArtifactVersionRefSchema).min(1).max(1e4) })
]);
var ArtifactCleanupProposalSchema = object({
  id: string2().min(1),
  artifactId: ArtifactIdSchema,
  title: string2(),
  versions: array(object({
    versionId: ArtifactVersionIdSchema,
    number: number2().int().positive(),
    createdAt: number2().int().nonnegative(),
    bytes: number2().int().nonnegative()
  })),
  bytes: number2().int().nonnegative()
});
var ArtifactImportFromPayloadSchema = object({
  machineId: string2().min(1).max(256),
  artifactId: ArtifactIdSchema,
  versionId: ArtifactVersionIdSchema,
  projectId: string2().min(1)
});
var ArtifactRemovePayloadSchema = object({
  artifactId: ArtifactIdSchema,
  versionIds: array(ArtifactVersionIdSchema).min(1).max(1e4).optional()
});
var ArtifactRemoveResultSchema = object({
  removed: number2().int().nonnegative(),
  freedBytes: number2().int().nonnegative()
});
var ArtifactCleanupResultSchema = object({
  proposals: array(ArtifactCleanupProposalSchema).optional(),
  removed: number2().int().nonnegative().optional(),
  freedBytes: number2().int().nonnegative().optional()
});

// packages/contracts/src/extension-actions.ts
var NodeRefSchema = object({ id: string2().min(1) });
var nodeInput = object({ node: NodeRefSchema });
var launchInput = object({ launch: string2().trim().min(1) });
var routineInput = object({ routine: string2().min(1) });
var publishedName = string2().min(1).max(ARTIFACT_LIMITS.fileNameLength);
var PublishedTextSchema = object({ name: publishedName, text: string2() });
var PublishedBytesSchema = object({ name: publishedName, base64: base642() });
var EXTENSION_PUBLISH_MAX_BYTES = 2 * 1024 * 1024;
var EXTENSION_ACTION_INPUTS = {
  "launch.list": object({}),
  "launch.read": launchInput.extend({ tail: number2().int().min(1).optional() }),
  "launch.start": launchInput,
  "launch.restart": launchInput,
  "launch.stop": launchInput,
  "routine.list": object({}),
  "routine.run": routineInput,
  "routine.pause": routineInput,
  "routine.resume": routineInput,
  "artifact.list": object({}),
  "artifact.read": object({ artifact: string2().min(1), version: string2().min(1).optional(), file: number2().int().nonnegative().optional() }),
  "artifact.publish": object({
    files: array(union([PublishedTextSchema, PublishedBytesSchema])).min(1).max(ARTIFACT_LIMITS.filesPerVersion),
    title: string2().trim().min(1).max(ARTIFACT_LIMITS.titleLength).optional(),
    kind: KnownArtifactKindSchema.optional(),
    key: ArtifactKeySchema.optional(),
    requestId: ArtifactRequestIdSchema.optional()
  }),
  "browser.inspect": nodeInput,
  "browser.navigate": nodeInput.extend({ url: string2().min(1) }),
  "browser.back": nodeInput,
  "browser.forward": nodeInput,
  "browser.reload": nodeInput.extend({ hard: boolean2().optional() }),
  "browser.screenshot": nodeInput,
  "device.list": object({}),
  "device.inspect": nodeInput,
  "device.screenshot": nodeInput,
  "device.tap": nodeInput.extend({ x: number2().min(0), y: number2().min(0) }),
  "device.launch": nodeInput.extend({ app: string2().trim().min(1).max(256) })
};
function parseExtensionActionInput(name, input) {
  const parsed = EXTENSION_ACTION_INPUTS[name].safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, message: `${name} takes another input: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  }
  return { ok: true, input: parsed.data };
}

// packages/contracts/src/extension-permissions.ts
var EXTENSION_ACTIONS = {
  "launch.list": "launches.read",
  "launch.read": "launches.read",
  "launch.start": "launches.run",
  "launch.restart": "launches.run",
  "launch.stop": "launches.run",
  "routine.list": "routines.read",
  "routine.run": "routines.run",
  "routine.pause": "routines.run",
  "routine.resume": "routines.run",
  "artifact.list": "artifacts.read",
  "artifact.read": "artifacts.read",
  "artifact.publish": "artifacts.write",
  "browser.inspect": "browser.control",
  "browser.navigate": "browser.control",
  "browser.back": "browser.control",
  "browser.forward": "browser.control",
  "browser.reload": "browser.control",
  "browser.screenshot": "browser.control",
  "device.list": "devices.control",
  "device.inspect": "devices.control",
  "device.screenshot": "devices.control",
  "device.tap": "devices.control",
  "device.launch": "devices.control"
};
function extensionActionPermission(action) {
  return Object.hasOwn(EXTENSION_ACTIONS, action) ? EXTENSION_ACTIONS[action] ?? null : null;
}

// packages/contracts/src/extension-vocabularies.generated.ts
var EXTENSION_SLOT_NAMES = [
  "selectionBar",
  "nodeHeader",
  "nodeMenu",
  "canvasMenu",
  "lineMenu",
  "viewToolbar",
  "viewMenu",
  "panelHeader",
  "commandPalette",
  "projectMenu",
  "sidebarFooter",
  "editorStatusBar",
  "sidebarRow",
  "tabMenu",
  "emptyCanvas",
  "startScreen",
  "projectBanner",
  "threadHeader",
  "emptyThread",
  "toolActions",
  "fileRowBadge",
  "fileBreadcrumb",
  "terminalMenu",
  "browserMenu",
  "textMenu",
  "noteToolbar",
  "routineMenu",
  "composer",
  "messageActions",
  "fileMenu",
  "editorToolbar",
  "editorMenu",
  "diffToolbar",
  "terminalToolbar",
  "browserToolbar",
  "viewAccessory"
];

// packages/contracts/src/extension-client.ts
function isExtensionSlotName(name) {
  return EXTENSION_SLOT_NAMES.includes(name);
}
var MACHINE_AREAS = {
  launch: "launches",
  routine: "routines",
  artifact: "artifacts",
  browser: "browser",
  device: "devices"
};
function extensionActionCall(action) {
  const dot = action.indexOf(".");
  return `${MACHINE_AREAS[action.slice(0, dot)] ?? action.slice(0, dot)}${action.slice(dot)}`;
}
var EXTENSION_CLIENT_PERMISSIONS = {
  "files.readText": "files.read",
  "files.write": "files.write",
  "files.list": "files.read",
  "files.watch": "files.read",
  "git.status": "git.read",
  "git.diff": "git.read",
  "git.log": "git.read",
  "terminals.read": "terminals.read",
  "terminals.open": "canvas.write",
  "database.connections": "database.read",
  "database.query": "database.read",
  "chats.list": "chats.read",
  "chats.read": "chats.read",
  "chats.send": "chats.send",
  "views.createCanvas": "views.write",
  "views.rename": "views.write",
  "context.read": "context.read",
  "agents.run": "agents.run",
  "agents.stream": "agents.run",
  "agents.start": "agents.start",
  "canvas.createNote": "canvas.write",
  "canvas.createFile": "canvas.write",
  "canvas.createBrowser": "canvas.write",
  "canvas.createNode": "canvas.write",
  "canvas.update": "canvas.write",
  "canvas.writeNote": "canvas.write",
  "canvas.arrange": "canvas.write",
  "canvas.remove": "canvas.write",
  "canvas.group": "canvas.write",
  "canvas.link": "canvas.write",
  "canvas.unlink": "canvas.write",
  useAgents: "agents.status",
  useAgent: "agents.status",
  useSubagents: "agents.status",
  useUsageLimits: "usage.read",
  Chat: "agents.start",
  ...Object.fromEntries(Object.entries(EXTENSION_ACTIONS).map(([action, permission]) => [extensionActionCall(action), permission]))
};
function extensionCallPermission(call) {
  return Object.hasOwn(EXTENSION_CLIENT_PERMISSIONS, call) ? EXTENSION_CLIENT_PERMISSIONS[call] ?? null : null;
}
function missingPermissionMessage(extension, permission) {
  return `${extension} did not ask for the permission ${permission} in its manifest`;
}
function lazyComponentProblem(surface, what) {
  const { component } = surface;
  if (surface.frame !== undefined || typeof component === "function" && component.length === 0 && !/^(class|function [A-Z])/.test(String(component))) {
    return null;
  }
  return `${what}: component must be a lazy import, such as () => import('./Panel')`;
}
function shortcutProblem(shortcut) {
  const parts = shortcut.toLowerCase().split("+");
  return parts.some((part) => part === "mod" || part === "alt") ? null : `${shortcut} has no modifier: a shortcut needs mod or alt`;
}
var WINDOWS_ABSOLUTE = /^([A-Za-z]:[\\/]|[\\/]{2})/;
function splitPath(path, separator) {
  const drive = /^([A-Za-z]:)[\\/]/.exec(path)?.[1];
  const root = drive !== undefined ? `${drive}${separator}` : /^[\\/]{2}/.test(path) ? `${separator}${separator}` : /^[\\/]/.test(path) ? separator : "";
  return {
    root,
    parts: path.slice(drive === undefined ? 0 : 2).split(/[\\/]/).filter((part) => part !== "" && part !== ".")
  };
}
function joinedPath({ root, parts }, separator) {
  return `${root}${parts.join(separator)}`;
}
function extensionProjectPath(folder, path) {
  const windows = WINDOWS_ABSOLUTE.test(folder);
  const separator = windows ? "\\" : "/";
  const absolute = path.startsWith("/") || path.startsWith("\\") || WINDOWS_ABSOLUTE.test(path);
  const inFolder = splitPath(folder, separator);
  const named = absolute ? splitPath(path, separator) : { root: inFolder.root, parts: [...inFolder.parts, ...splitPath(path, separator).parts] };
  const root = joinedPath(inFolder, separator);
  const joined = joinedPath(named, separator);
  const same = (text) => windows ? text.toLowerCase() : text;
  const within = same(root.endsWith(separator) ? root : `${root}${separator}`);
  if (named.parts.includes("..") || same(joined) !== same(root) && !same(joined).startsWith(within)) {
    return null;
  }
  return joined;
}
function wordsOver(english, own) {
  const merged = { ...english };
  for (const [key, value] of Object.entries(own)) {
    const under = merged[key];
    merged[key] = typeof value === "object" && typeof under === "object" ? wordsOver(under, value) : value;
  }
  return merged;
}
function wordAt(words, key) {
  const flat = words[key];
  if (typeof flat === "string") {
    return flat;
  }
  let found = words;
  for (const part of key.split(".")) {
    found = typeof found === "object" ? found[part] : undefined;
  }
  return typeof found === "string" ? found : undefined;
}
function extensionWord(words, language, key, values = {}) {
  const count = values.count;
  const plural = typeof count === "number" ? [`${key}_${new Intl.PluralRules(language).select(count)}`, `${key}_other`] : [];
  const text = [...plural, key].map((each) => wordAt(words, each)).find((each) => each !== undefined) ?? key;
  return Object.entries(values).reduce((written, [name, value]) => written.replaceAll(`{{${name}}}`, String(value)), text);
}

// packages/contracts/src/extension-context.ts
function contextSelection(of) {
  const named = new Set(of.nodeIds ?? []);
  return (nodeId, viewId) => viewId === of.viewId || named.has(nodeId);
}

// packages/contracts/src/node-accents.ts
var NODE_ACCENT_COLORS = {
  red: "#e7000b",
  orange: "#f54900",
  amber: "#e17100",
  yellow: "#d08700",
  lime: "#5ea500",
  green: "#00a63e",
  emerald: "#009966",
  teal: "#009689",
  cyan: "#0092b8",
  sky: "#0084d1",
  blue: "#155dfc",
  indigo: "#4f39f6",
  violet: "#7f22fe",
  purple: "#9810fa",
  fuchsia: "#c800de",
  pink: "#e60076",
  rose: "#ec003f"
};

// packages/contracts/src/extension-results.ts
function extensionAgentStatus(status, needsYou = false) {
  if (needsYou || status === "needs-you") {
    return "needsYou";
  }
  if (status === "running") {
    return "running";
  }
  return status === "idle" ? "idle" : "stopped";
}
function extensionChatOf(info) {
  return {
    id: info.chatId,
    provider: info.provider,
    status: extensionAgentStatus(info.status, (info.requests?.length ?? 0) > 0),
    model: info.model,
    cwd: info.cwd
  };
}

// apps/server/src/extensions/policy.ts
var SERVER_EVENTS = {
  "chat.status": {
    permission: "chats.read",
    payload: ({ info }) => ({ chat: extensionChatOf(info) })
  },
  "chat.event": {
    permission: "chats.read",
    payload: ({ chatId }) => ({ chatId })
  },
  "session.status": {
    permission: "terminals.read",
    payload: ({ sessionId, agent }) => ({
      nodeId: sessionId,
      status: extensionAgentStatus(agent?.status, (agent?.requests?.length ?? 0) > 0)
    })
  }
};
function serverEvent(name) {
  return Object.hasOwn(SERVER_EVENTS, name) ? SERVER_EVENTS[name] ?? null : null;
}
function permissionsOf(manifest) {
  return new Set(Object.keys(manifest?.permissions ?? {}));
}
function eventRefusal(name, permissions) {
  const event = serverEvent(name);
  if (event === null) {
    return `${name} is no event an extension can follow`;
  }
  return permissions.has(event.permission) ? null : `${name} needs the permission ${event.permission} in manifest.json`;
}
function missingPermission(id, permission, permissions) {
  if (permissions.has(permission)) {
    return null;
  }
  return { code: "permission-denied", message: missingPermissionMessage(id, permission) };
}
function actionRefusal(id, action, permissions) {
  const permission = extensionActionPermission(action);
  if (permission === null) {
    return { code: "not-found", message: `An extension cannot ask for ${action}` };
  }
  return missingPermission(id, permission, permissions);
}
var STORAGE_ASKS = new Set(["storage.get", "storage.set", "storage.delete"]);
function askRefusal(id, method, args, permissions) {
  if (STORAGE_ASKS.has(method)) {
    return null;
  }
  if (method === "action") {
    return actionRefusal(id, String(args[1]), permissions);
  }
  if (method === "languages.add") {
    return missingPermission(id, "languages.servers", permissions);
  }
  return missingPermission(id, method === "chats.list" || method === "chats.read" ? "chats.read" : method, permissions);
}
var MAX_SENDS_PER_HOUR = 20;
var HOUR_MS = 3600000;

class SendLimit {
  sends = new Map;
  now;
  constructor(now) {
    this.now = now;
  }
  take(id, chatId) {
    const now = this.now();
    const key = `${id}:${chatId}`;
    const recent = (this.sends.get(key) ?? []).filter((at) => now - at < HOUR_MS);
    if (recent.length >= MAX_SENDS_PER_HOUR) {
      this.sends.set(key, recent);
      return { code: "limit", message: `${id} sent ${chatId} ${MAX_SENDS_PER_HOUR} messages this hour and has to wait` };
    }
    this.sends.set(key, [...recent, now]);
    return null;
  }
}
var SCHEDULE_NEEDS_CLOCK = "schedule needs the permission clock in manifest.json";
var UNITS = { s: 1000, m: 60000, h: 3600000 };
var MIN_EVERY_MS = 1e4;
var MAX_EVERY_MS = 2 ** 31 - 1;
function everyMs(every) {
  const match = /^(\d+)([smh])$/.exec(every);
  const ms = match === null ? 0 : Number(match[1]) * UNITS[match[2]];
  if (!Number.isFinite(ms) || ms < MIN_EVERY_MS || ms > MAX_EVERY_MS) {
    throw new Error(`schedule takes something like 30s, 5m or 1h, of at least 10 seconds and at most 596h, not ${every}`);
  }
  return ms;
}

// apps/server/src/extensions/server-api.ts
class MissingHandler extends Error {
}
function mapResult(result, next) {
  return result.ok ? { ok: true, value: next(result.value) } : result;
}
function callHandler(handlers, method, args) {
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
  if (typeof handler !== "function") {
    throw new MissingHandler(`No method ${method}`);
  }
  return handler(...args);
}
function createServerApi(options) {
  const { ask, send, permissions } = options;
  const listeners = new Map;
  const tools = new Map;
  const nodeContexts = new Map;
  const typed = (method, args) => ask(method, args);
  const server = {
    machine: {
      platform: options.platform,
      dataFolder: options.dataFolder,
      run: (project, action, input) => typed("action", [project.id, action, input ?? {}])
    },
    defineLanguageServer: async (languageServer) => mapResult(await ask("languages.add", [languageServer]), () => {
      return;
    }),
    agents: {
      run: (runOptions) => typed("agents.run", [runOptions]),
      async start({
        project,
        folder,
        view,
        near,
        prompt,
        provider,
        title,
        hidden
      }) {
        if (project === undefined === (folder === undefined)) {
          throw new TypeError("agents.start needs a project or a folder, not both");
        }
        const beside = near?.[0]?.id;
        const placed = folder === undefined && hidden !== true;
        const started = await typed("agents.start", [
          {
            projectId: project?.id ?? "",
            ...folder === undefined ? {} : { folder },
            ...view === undefined || !placed ? {} : { viewId: view.id },
            ...beside === undefined || !placed ? {} : { beside },
            ...prompt === undefined ? {} : { prompt },
            ...provider === undefined ? {} : { provider },
            ...title === undefined ? {} : { title },
            ...hidden === true ? { hidden: true } : {}
          }
        ]);
        return mapResult(started, ({ nodeId }) => ({ id: nodeId }));
      }
    },
    chats: {
      list: () => typed("chats.list", []),
      read: (chatId) => typed("chats.read", [chatId]),
      send: async (chatId, text) => mapResult(await ask("chats.send", [chatId, text]), () => {
        return;
      })
    },
    defineAgentTool(tool) {
      tools.set(tool.id, tool);
      send({ type: "tool", name: tool.id, description: tool.description, parameters: tool.parameters ?? { type: "object", properties: {} } });
    },
    schedule(task) {
      if (!permissions.has("clock")) {
        throw new Error(SCHEDULE_NEEDS_CLOCK);
      }
      options.clock.every(everyMs(task.every), () => (async () => {
        await task.run();
      })().catch((e) => options.log.error(`${task.id} failed:`, e)));
    },
    defineServer: (api) => api,
    onEvent(name, listener) {
      const group = listeners.get(name) ?? new Set;
      const heard = listener;
      group.add(heard);
      listeners.set(name, group);
      send({ type: "subscribe", name });
      return () => {
        group.delete(heard);
      };
    },
    emit(name, payload) {
      send({ type: "emit", name, payload });
    },
    defineNodeContext(nodeType, read) {
      nodeContexts.set(nodeType, read);
    },
    storage: {
      get: async (key) => await options.storage.get(key),
      set: (key, value) => options.storage.set(key, value),
      delete: (key) => options.storage.delete(key)
    },
    secrets: {
      get: async (key) => await options.secrets.get(key),
      set: (key, value) => options.secrets.set(key, value)
    },
    log: options.log
  };
  return {
    server,
    runTool(name, input, context) {
      const tool = tools.get(name);
      if (tool === undefined) {
        throw new MissingHandler(`No tool ${name}`);
      }
      return tool.run(input, context);
    },
    readNodeContext: (nodeType, data) => nodeContexts.get(nodeType)?.({ data }) ?? [],
    deliver(name, payload) {
      for (const listener of listeners.get(name) ?? []) {
        listener(payload);
      }
    }
  };
}

// apps/server/src/extensions/test-host.ts
import { readFileSync as readFileSync2 } from "fs";
import { join as join4 } from "path";

// packages/contracts/src/node-defaults.ts
var NODE_SIZE = {
  terminal: { w: 560, h: 360 },
  chat: { w: 480, h: 520 },
  browser: { w: 720, h: 480 },
  device: { w: 360, h: 720 },
  group: { w: 800, h: 600 },
  note: { w: 320, h: 240 },
  drawing: { w: 480, h: 360 },
  diagram: { w: 480, h: 360 },
  file: { w: 520, h: 420 },
  artifact: { w: 440, h: 520 },
  routine: { w: 400, h: 560 },
  design: { w: 480, h: 640 }
};
var GROUP_PADDING = 32;
var GROUP_HEADER = 40;
var CANVAS_GRID = 8;
function snap(value) {
  return Math.round(value / CANVAS_GRID) * CANVAS_GRID;
}
function groupFrame(members) {
  if (members.length === 0) {
    return null;
  }
  const left = Math.min(...members.map((member) => member.x));
  const top = Math.min(...members.map((member) => member.y));
  const width = Math.max(...members.map((member) => member.x + member.w)) - left;
  const height = Math.max(...members.map((member) => member.y + member.h)) - top;
  return {
    x: snap(left - GROUP_PADDING),
    y: snap(top - GROUP_PADDING - GROUP_HEADER),
    w: snap(width + GROUP_PADDING * 2),
    h: snap(height + GROUP_PADDING * 2 + GROUP_HEADER)
  };
}
var DEFAULT_TITLES = {
  terminal: "Terminal",
  chat: "New chat",
  browser: "Browser",
  device: "Simulator",
  group: "Group",
  drawing: "Drawing",
  diagram: "Diagram",
  note: "Note",
  file: "File",
  artifact: "Output",
  routine: "Routine",
  design: "Design"
};

// apps/server/src/extensions/test-server.ts
import { mkdtempSync as mkdtempSync2, readFileSync, rmSync as rmSync2 } from "fs";
import { tmpdir } from "os";
import { join as join3, resolve } from "path";

// apps/server/src/extensions/test-loader.ts
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join as join2, relative } from "path";
import { pathToFileURL } from "url";
var apis = new Map;
var loads = 0;
var cache = null;
globalThis.__ruimteExtensionTest = { for: (key) => apis.get(key) };
function cacheFolder() {
  if (cache === null) {
    const parent = join2(process.cwd(), "node_modules", ".cache");
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(join2(parent, "ruimte-extension-load-"));
    process.on("exit", () => rmSync(folder, { recursive: true, force: true }));
    cache = folder;
  }
  return cache;
}
async function loadFresh(entry, bound) {
  loads += 1;
  const load = loads;
  for (const [name, api] of Object.entries(bound)) {
    apis.set(`${load}:${name}`, api);
  }
  const build = await Bun.build({
    entrypoints: [entry],
    outdir: join2(cacheFolder(), String(load)),
    target: "bun",
    format: "esm",
    splitting: true,
    packages: "external",
    sourcemap: "inline",
    jsx: { runtime: "automatic", development: false },
    plugins: [
      {
        name: "ruimte-extension-test",
        setup(builder) {
          builder.onResolve({ filter: /^@ruimte\/extension\// }, (args) => Object.hasOwn(bound, args.path) ? { path: args.path, namespace: "ruimte-test" } : undefined);
          builder.onLoad({ filter: /.*/, namespace: "ruimte-test" }, (args) => ({
            contents: `module.exports = globalThis.__ruimteExtensionTest.for(${JSON.stringify(`${load}:${args.path}`)});`,
            loader: "js"
          }));
        }
      }
    ],
    throw: false
  });
  const output = build.outputs.find((each) => each.kind === "entry-point");
  if (!build.success || output === undefined) {
    throw new Error(`${relative(process.cwd(), entry)} did not build:
${build.logs.map(String).join(`
`)}`);
  }
  return await import(pathToFileURL(output.path).href);
}

// apps/server/src/extensions/test-server.ts
var DURATION_UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000 };

class TestRefusal extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function refusal(code, message) {
  return new TestRefusal(code, message);
}
function wire(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
function failure2(code, message) {
  return { ok: false, error: { code, message } };
}
function durationMs(duration) {
  if (typeof duration === "number") {
    return duration;
  }
  const match = /^(\d+)(ms|s|m|h)$/.exec(duration);
  if (match === null) {
    throw new TypeError(`advance takes milliseconds or something like 30s, 5m or 1h, not ${duration}`);
  }
  return Number(match[1]) * DURATION_UNITS[match[2]];
}
function manifestIn(folder) {
  try {
    return JSON.parse(readFileSync(join3(folder, "manifest.json"), "utf8"));
  } catch {
    return {};
  }
}
function memory(values, changed = () => {
  return;
}) {
  return {
    get: async (key) => Object.hasOwn(values, key) ? wire(values[key]) : undefined,
    set: async (key, value) => {
      if (value === undefined) {
        delete values[key];
      } else {
        values[key] = wire(value);
      }
      changed();
    },
    delete: async (key) => {
      delete values[key];
      changed();
    }
  };
}
var folders = new Set;
function removeTestFolders() {
  for (const folder of folders) {
    rmSync2(folder, { recursive: true, force: true });
  }
  folders.clear();
}
var machineStorageOf = new WeakMap;
function startOptions(start) {
  return {
    ...start.projectId === "" ? {} : { project: { id: start.projectId } },
    ...start.folder === undefined ? {} : { folder: start.folder },
    ...start.hidden === true ? { hidden: true } : {},
    ...start.viewId === undefined ? {} : { view: { id: start.viewId } },
    ...start.beside === undefined ? {} : { near: [{ id: start.beside }] },
    ...start.prompt === undefined ? {} : { prompt: start.prompt },
    ...start.provider === undefined ? {} : { provider: start.provider },
    ...start.title === undefined ? {} : { title: start.title }
  };
}

class TestMachine {
  id;
  storage;
  secrets;
  emitted = [];
  storageListeners = new Set;
  asked = [];
  languageServers = [];
  logs = [];
  core;
  permissions;
  answers;
  subscriptions = new Set;
  tools = new Map;
  scheduled = [];
  sends;
  now = 0;
  constructor(options, folder) {
    const manifest = { ...manifestIn(folder), ...options.manifest };
    this.id = manifest.id ?? "test.extension";
    this.permissions = permissionsOf(manifest);
    this.answers = options.answers ?? {};
    this.storage = wire(options.storage ?? {});
    this.secrets = { ...options.secrets };
    this.sends = new SendLimit(() => this.now);
    const dataFolder = mkdtempSync2(join3(tmpdir(), `ruimte-extension-test-${this.id}-`));
    folders.add(dataFolder);
    this.core = createServerApi({
      dataFolder,
      platform: process.platform,
      permissions: this.permissions,
      ask: (method, args) => this.ask(method, args),
      clock: {
        every: (every, run) => {
          this.scheduled.push({ every, due: this.now + every, run });
        }
      },
      send: (message) => this.said(message),
      storage: memory(this.storage, () => {
        for (const listener of [...this.storageListeners]) {
          listener();
        }
      }),
      secrets: memory(this.secrets),
      log: {
        info: (message) => void this.logs.push(message),
        error: (message, error) => void this.logs.push(error === undefined ? message : `${message} ${error instanceof Error ? error.message : String(error)}`)
      }
    });
  }
  clockNow() {
    return this.now;
  }
  async advance(duration) {
    const until = this.now + durationMs(duration);
    for (let next = this.nextDue(until);next !== null; next = this.nextDue(until)) {
      this.now = next.due;
      next.due += next.every;
      await next.run();
    }
    this.now = until;
  }
  nextDue(until) {
    const due = this.scheduled.filter((task) => task.due <= until).sort((left, right) => left.due - right.due);
    return due[0] ?? null;
  }
  fire(name, payload) {
    if (this.subscriptions.has(name)) {
      this.core.deliver(name, wire(payload));
    }
  }
  async runTool(id, input, caller) {
    if (this.tools.get(id) !== true) {
      const missing = `No tool ${this.id}/${id}. tool_list says what there is`;
      throw new Error(this.tools.has(id) ? `${missing}. defineAgentTool needs the permission agents.tools in manifest.json` : missing);
    }
    const answer = await this.core.runTool(id, wire(input), { caller });
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  }
  said(message) {
    if (message.type === "emit") {
      this.emitted.push(message.payload === undefined ? { name: message.name } : { name: message.name, payload: wire(message.payload) });
    } else if (message.type === "tool") {
      this.tools.set(message.name, this.permissions.has("agents.tools"));
    } else {
      const reason = eventRefusal(message.name, this.permissions);
      if (reason === null) {
        this.subscriptions.add(message.name);
      } else {
        this.logs.push(reason);
      }
    }
  }
  async ask(method, args) {
    const refused = askRefusal(this.id, method, args, this.permissions);
    if (refused === null && method === "action") {
      args = [args[0], args[1], this.actionInput(args[1], args[2])];
    }
    const [name, recorded] = this.named(method, args);
    const result = refused === null ? await this.answer(method, args) : this.refused(method, refused);
    this.asked.push({ method: name, args: wire(recorded), result });
    return result;
  }
  actionInput(action, input) {
    const parsed = parseExtensionActionInput(action, wire(input));
    if (!parsed.ok) {
      this.logs.push(`action answered invalid-input: ${parsed.message}`);
      throw new TypeError(parsed.message);
    }
    return parsed.input;
  }
  refused(method, { code, message }) {
    this.logs.push(`${method} answered ${code}: ${message}`);
    return failure2(code, message);
  }
  named(method, args) {
    if (method === "action") {
      return ["machine.run", [{ id: args[0] }, args[1], args[2]]];
    }
    if (method === "languages.add") {
      return ["defineLanguageServer", args];
    }
    if (method === "agents.start") {
      return ["agents.start", [startOptions(args[0])]];
    }
    return [method, args];
  }
  async answer(method, args) {
    if (method === "languages.add") {
      this.languageServers.push(wire(args[0]));
      return { ok: true, value: null };
    }
    const answer = this.scripted(method, args);
    if (answer === null) {
      return this.refused(method, { code: "unavailable", message: `Nothing answers ${method} in this test. Give it under answers` });
    }
    if (method === "chats.send") {
      const limited = this.sends.take(this.id, String(args[0]));
      if (limited !== null) {
        return this.refused(method, limited);
      }
    }
    try {
      const value = await answer();
      return { ok: true, value: wire(method === "agents.start" ? { nodeId: value.id } : value) };
    } catch (e) {
      if (e instanceof TestRefusal) {
        return this.refused(method, { code: e.code, message: e.message });
      }
      return this.refused(method, { code: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }
  scripted(method, args) {
    const answers = this.answers;
    if (method === "action") {
      const [projectId, action, input] = args;
      const run = this.answers["machine.run"]?.[action];
      return run === undefined ? null : () => run(wire(input), { id: projectId });
    }
    const run = answers[method];
    if (run === undefined) {
      return null;
    }
    return method === "agents.start" ? () => run(startOptions(args[0])) : () => run(...wire(args));
  }
}
var current = null;
function currentServer() {
  current ??= new TestMachine({}, process.cwd());
  return current.core.server;
}
async function createTestServer(options = {}) {
  const folder = process.cwd();
  const machine = new TestMachine(options, folder);
  current = machine;
  const module = await loadFresh(resolve(folder, options.entry ?? join3("server", "index.ts")), { "@ruimte/extension/server": machine.core.server });
  const handlers = module.default ?? {};
  const call = async (method, ...args) => {
    try {
      return { ok: true, value: wire(await callHandler(handlers, method, wire(args))) };
    } catch (e) {
      return failure2(e instanceof MissingHandler ? "not-found" : "failed", e instanceof Error ? e.message : String(e));
    }
  };
  const server = {
    call,
    storage: machine.storage,
    secrets: machine.secrets,
    clock: { now: () => machine.clockNow(), advance: (duration) => machine.advance(duration) },
    fire: (name, payload) => machine.fire(name, payload),
    emitted: machine.emitted,
    asked: machine.asked,
    languageServers: machine.languageServers,
    logs: machine.logs,
    tool: (id) => ({ run: (input = {}, context = {}) => machine.runTool(id, input, context.caller ?? "test") }),
    nodeContext: async (nodeType, data) => wire(await machine.core.readNodeContext(nodeType, wire(data)))
  };
  machineStorageOf.set(server, {
    values: machine.storage,
    subscribe: (listener) => {
      machine.storageListeners.add(listener);
      return () => {
        machine.storageListeners.delete(listener);
      };
    }
  });
  return server;
}

// apps/server/src/extensions/test-host.ts
class Refused extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
var NOTE = { width: 320, height: 200 };
var NEW_NODE = { width: 420, height: 300 };
var BESIDE_GAP = 240;
var NODE_PLACES = ["node", "nodes", "from", "to"];
var AGENT_KINDS = new Set(["terminal", "chat", "design"]);
function snapped(value) {
  return Math.round(value / CANVAS_GRID) * CANVAS_GRID;
}
function sizeOfKind(kind) {
  const size = NODE_SIZE[kind];
  return size === undefined ? NEW_NODE : { width: size.w, height: size.h };
}
function agentIn(kind, agent) {
  if (kind !== "chat" && kind !== "design" && (kind !== "terminal" || agent === undefined)) {
    return;
  }
  return { provider: null, account: null, status: "idle", activity: null, snoozed: false, cwd: null, branch: null, worktree: null, ...agent };
}
function wire2(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function manifestIn2(folder) {
  try {
    return JSON.parse(readFileSync2(join4(folder, "manifest.json"), "utf8"));
  } catch {
    return {};
  }
}
function wordsIn(folder, language) {
  const read = (name) => {
    try {
      return JSON.parse(readFileSync2(join4(folder, "locales", `${name}.json`), "utf8"));
    } catch {
      return {};
    }
  };
  return wordsOver(read("en"), read(language));
}
function errorText(e) {
  return e instanceof Error ? e.message : String(e);
}

class TestHost {
  id;
  name;
  folder;
  permissions;
  answers;
  language;
  theme;
  machineId;
  project;
  views;
  nodes = new Map;
  chats = new Map;
  viewAgents = new Map;
  providers;
  focused = [];
  canvasView;
  watches = new Set;
  edges = [];
  createdIds = [];
  notes = [];
  revealed = [];
  definitions = [];
  entries = [];
  entryOf = new WeakMap;
  notifications = [];
  dialogs = [];
  opened = [];
  panels = {};
  copied = [];
  calls = [];
  logs = [];
  storage;
  settings;
  words;
  serverCache = new Map;
  runs = [];
  activeViewId;
  selection;
  listeners = new Map;
  changes = new Set;
  version = 0;
  nextId = 1;
  constructor(options, folder) {
    const manifest = { ...manifestIn2(folder), ...options.manifest };
    const project = options.project === null ? null : {
      id: options.project?.id ?? "test-project",
      name: options.project?.name ?? "Test",
      folder: options.project?.folder === undefined ? "/test/project" : options.project.folder
    };
    this.id = manifest.id ?? "test.extension";
    this.name = manifest.name ?? this.id;
    this.folder = folder;
    this.permissions = new Set(Object.keys(manifest.permissions ?? {}));
    this.answers = options.answers ?? {};
    this.language = options.language ?? "en";
    this.theme = options.theme ?? "dark";
    this.machineId = options.machine?.id ?? "local";
    this.project = project;
    this.views = project === null ? [] : (options.project?.views ?? [{ id: "test-view", kind: "canvas", name: "Canvas" }]).map((view) => ({
      id: view.id,
      kind: view.kind ?? "canvas",
      name: view.name ?? ""
    }));
    this.activeViewId = this.views[0]?.id ?? null;
    this.providers = (options.providers ?? [{ id: "claude", name: "Claude" }]).map((provider) => ({ ...provider }));
    this.canvasView = {
      visible: { x: 0, y: 0, width: 1280, height: 800, ...options.canvas?.visible },
      zoom: options.canvas?.zoom ?? 1,
      gesture: options.canvas?.gesture ?? "none"
    };
    const server = this.answers.server === undefined ? undefined : machineStorageOf.get(this.answers.server);
    this.storage = {
      computer: wire2(options.storage?.computer ?? {}),
      project: wire2(options.storage?.project ?? {}),
      machine: server === undefined ? wire2(options.storage?.machine ?? {}) : Object.assign(server.values, wire2(options.storage?.machine ?? {}))
    };
    server?.subscribe(() => this.changed());
    this.settings = { ...options.settings };
    this.words = wordsIn(folder, this.language);
    for (const node of options.project?.nodes ?? []) {
      this.nodes.set(node.id, {
        id: node.id,
        kind: node.extension === undefined ? node.kind ?? "note" : "extension",
        title: node.title ?? "",
        text: node.text ?? "",
        color: node.color ?? null,
        bounds: node.bounds ?? { ...NOTE, x: 0, y: 0 },
        viewId: node.view ?? this.activeViewId ?? "",
        groupId: null,
        hidden: node.hidden === true,
        ...node.agent === undefined ? {} : { agent: node.agent },
        ...node.subagents === undefined ? {} : { subagents: node.subagents },
        ...node.path === undefined ? {} : { path: node.path },
        ...node.url === undefined ? {} : { url: node.url },
        ...node.extension === undefined ? {} : { extension: { id: this.id, type: node.extension.type }, data: wire2(node.extension.data ?? {}) },
        ...node.extension?.dataVersion === undefined ? {} : { dataVersion: node.extension.dataVersion }
      });
      if (node.kind === "chat") {
        this.chats.set(node.id, {
          id: node.id,
          title: node.title ?? "",
          text: node.text ?? "",
          provider: node.agent?.provider ?? "claude",
          status: node.agent?.status ?? "idle"
        });
      }
    }
    for (const node of options.project?.nodes ?? []) {
      for (const to of node.linkedTo ?? []) {
        this.addEdge(node.id, to);
      }
    }
    this.selection = [...options.selection ?? []];
  }
  subscribe(listener) {
    this.changes.add(listener);
    return () => {
      this.changes.delete(listener);
    };
  }
  snapshot() {
    return this.version;
  }
  changed() {
    this.version += 1;
    for (const listener of [...this.changes]) {
      listener();
    }
  }
  listen(name, listener) {
    const group = this.listeners.get(name) ?? new Set;
    group.add(listener);
    this.listeners.set(name, group);
    return () => {
      group.delete(listener);
    };
  }
  deliver(name, payload) {
    for (const listener of [...this.listeners.get(name) ?? []]) {
      listener(payload);
    }
  }
  record(kind, definition) {
    this.definitions.push({ kind, definition });
  }
  addEntry(definition, entry) {
    const at = this.entries.findIndex((each) => each.id === entry.id);
    if (at >= 0) {
      this.entries.splice(at, 1);
    }
    this.entries.push(entry);
    this.entryOf.set(definition, entry);
  }
  defined(kind, id) {
    const ofKind = this.definitions.filter((each) => each.kind === kind);
    const found = ofKind.find((each) => each.definition.id === id);
    if (found === undefined) {
      const ids = ofKind.map((each) => each.definition.id);
      throw new Error(`No ${kind} ${id}. ${ids.length === 0 ? `The extension defined no ${kind}` : `There is ${ids.join(", ")}`}`);
    }
    return found.definition;
  }
  permitCall(what) {
    const permission = extensionCallPermission(what);
    if (permission !== null) {
      this.permit(permission);
    }
  }
  permit(permission) {
    if (!this.permissions.has(permission)) {
      throw new Refused("permission-denied", missingPermissionMessage(this.name, permission));
    }
  }
  hookPermission(hook) {
    const permission = extensionCallPermission(hook);
    if (permission !== null && !this.permissions.has(permission)) {
      throw new Error(missingPermissionMessage(this.name, permission));
    }
  }
  refusalOf(what, args, e) {
    if (e instanceof TypeError) {
      throw e;
    }
    return this.failure(what, args, e);
  }
  failure(what, args, e) {
    const error = e instanceof Refused || e instanceof TestRefusal ? { code: e.code, message: e.message } : { code: "failed", message: errorText(e) };
    this.logs.push(`${what}: ${error.code}: ${error.message}`);
    this.calls.push({ method: what, args, result: { ok: false, error } });
    return { ok: false, error };
  }
  attempt(what, args, run) {
    try {
      this.permitCall(what);
      const value = run();
      this.calls.push({ method: what, args, result: { ok: true, value } });
      return { ok: true, value };
    } catch (e) {
      return this.refusalOf(what, args, e);
    }
  }
  async settle(what, args, run) {
    try {
      this.permitCall(what);
      const value = await run();
      this.calls.push({ method: what, args, result: { ok: true, value } });
      return { ok: true, value };
    } catch (e) {
      return this.refusalOf(what, args, e);
    }
  }
  async scripted(path, args, fallback) {
    const answer = this.answers[path];
    if (typeof answer === "function") {
      return wire2(await answer(...wire2(args)));
    }
    if (fallback !== undefined) {
      return fallback();
    }
    throw new Refused("unavailable", `Nothing answers ${path} in this test. Give it under answers`);
  }
  projectId() {
    if (this.project === null) {
      throw new Refused("no-project", "This needs an open project");
    }
    return this.project.id;
  }
  inProject(path) {
    const folder = this.project?.folder;
    if (folder === null || folder === undefined) {
      throw new Refused("no-project", "This needs a project with a folder");
    }
    const full = extensionProjectPath(folder, path);
    if (full === null) {
      throw new Refused("outside-project", `${path} is outside the project folder`);
    }
    return full;
  }
  canvasInFront() {
    const view = this.views.find((each) => each.id === this.activeViewId);
    if (view?.kind !== "canvas") {
      throw new Refused("no-canvas", "This needs a canvas in front");
    }
    return view.id;
  }
  nodeOnCanvas(node) {
    const found = this.nodes.get(node.id);
    if (found === undefined) {
      throw new Refused("not-found", `No node ${node.id} on a canvas of this window`);
    }
    return found;
  }
  beside(near) {
    const anchor = near?.[0] === undefined ? undefined : this.nodes.get(near[0].id);
    return anchor === undefined ? { x: 0, y: 0 } : { x: anchor.bounds.x + anchor.bounds.width + BESIDE_GAP, y: anchor.bounds.y + anchor.bounds.height / 2 };
  }
  addNode(kind, at, details, size = sizeOfKind(kind)) {
    const bounds = { x: snapped(at.x - size.width / 2), y: snapped(at.y - size.height / 2), ...size };
    return this.placeNode(kind, bounds, { title: DEFAULT_TITLES[kind] ?? "", ...details });
  }
  placeNode(kind, bounds, details) {
    const viewId = this.canvasInFront();
    let id = `${kind}-${this.nextId}`;
    while (this.nodes.has(id)) {
      this.nextId += 1;
      id = `${kind}-${this.nextId}`;
    }
    this.nextId += 1;
    this.nodes.set(id, { id, kind, title: "", text: "", color: null, bounds, viewId, groupId: null, hidden: false, ...details });
    this.createdIds.push(id);
    this.changed();
    this.deliver("node.added", { node: this.info(id) });
    this.select([id]);
    return { id };
  }
  addGroup(ids) {
    const viewId = this.canvasInFront();
    const members = ids.flatMap((id) => {
      const node = this.nodes.get(id);
      return node === undefined || node.viewId !== viewId || node.kind === "group" ? [] : [node];
    });
    const frame = groupFrame(members.map(({ bounds }) => ({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height })));
    if (frame === null) {
      return null;
    }
    const group = this.placeNode("group", { x: frame.x, y: frame.y, width: frame.w, height: frame.h }, { title: DEFAULT_TITLES.group });
    for (const member of members) {
      this.changeNode(member.id, { groupId: group.id });
    }
    return group;
  }
  addChatView(title, provider, hidden = false) {
    const view = hidden ? { id: `chat-${this.chats.size + 1}` } : this.addView("chat", title);
    this.chats.set(view.id, { id: view.id, title, text: "", provider, status: "running" });
    return view;
  }
  changeFile(path) {
    const full = this.inProject(path);
    for (const watch of [...this.watches]) {
      const folder = /[\\/]$/.test(watch.path) ? watch.path : `${watch.path}/`;
      if (full === watch.path || full.startsWith(folder) || full.startsWith(folder.replace(/\/$/, "\\"))) {
        watch.listener();
      }
    }
  }
  migrateNode(definition, nodeId) {
    const { dataVersion, migrate } = definition;
    const node = this.nodes.get(nodeId);
    if (node === undefined || typeof dataVersion !== "number" || typeof migrate !== "function") {
      return;
    }
    const from = node.dataVersion ?? 1;
    if (from < dataVersion) {
      this.changeNode(nodeId, { data: wire2(migrate(node.data, from)), dataVersion });
    }
  }
  addView(kind, name) {
    let count = this.views.length + 1;
    while (this.views.some((view) => view.id === `view-${count}`)) {
      count += 1;
    }
    const id = `view-${count}`;
    this.views.push({ id, kind, name });
    this.changed();
    return { id };
  }
  changeNode(id, change) {
    const node = this.nodes.get(id);
    if (node !== undefined) {
      Object.assign(node, change);
      this.changed();
      this.deliver("node.changed", { node: this.info(id) });
    }
  }
  addEdge(from, to) {
    const start = this.nodes.get(from);
    const end = this.nodes.get(to);
    if (start === undefined || end === undefined || start.viewId !== end.viewId) {
      return;
    }
    const draw = (tail, head) => {
      if (tail !== head && !this.edges.some((edge) => edge.from === tail && edge.to === head)) {
        this.edges.push({ from: tail, to: head });
      }
    };
    draw(from, to);
    if (AGENT_KINDS.has(start.kind) && AGENT_KINDS.has(end.kind)) {
      draw(to, from);
    }
  }
  remove(ids) {
    const viewId = this.canvasInFront();
    const gone = ids.filter((id) => this.nodes.get(id)?.viewId === viewId);
    for (const id of gone) {
      this.nodes.delete(id);
      this.deliver("node.removed", { id });
    }
    this.edges.splice(0, this.edges.length, ...this.edges.filter((edge) => !gone.includes(edge.from) && !gone.includes(edge.to)));
    this.select([]);
  }
  select(ids) {
    this.selection = [...ids];
    this.changed();
    this.deliver("selection.changed", { nodes: this.selection.map((id) => this.info(id)) });
  }
  openView(id) {
    if (id === this.activeViewId) {
      return;
    }
    this.activeViewId = id;
    this.changed();
    this.deliver("view.changed", { viewId: id });
  }
  unknownNode(id, viewId) {
    return {
      id,
      kind: "unknown",
      title: "",
      color: null,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      groupId: null,
      hidden: false,
      viewId,
      machine: null,
      linkedTo: []
    };
  }
  info(id) {
    const node = this.nodes.get(id);
    if (node === undefined) {
      return this.unknownNode(id, this.activeViewId ?? "");
    }
    const agent = agentIn(node.kind, node.agent);
    return {
      id,
      kind: node.kind,
      title: node.title,
      color: node.color,
      bounds: { ...node.bounds },
      groupId: node.groupId,
      hidden: node.hidden,
      viewId: node.viewId,
      machine: null,
      linkedTo: [...new Set(this.edges.flatMap((edge) => edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []))],
      ...agent === undefined ? {} : { agent },
      ...node.path === undefined ? {} : { path: node.path },
      ...node.url === undefined ? {} : { url: node.url },
      ...node.extension === undefined ? {} : { extension: { ...node.extension } }
    };
  }
  agentOf(id, canvas) {
    const node = this.nodes.get(id);
    if (node !== undefined) {
      return node.viewId === canvas ? this.info(id).agent ?? null : null;
    }
    const view = this.views.find((each) => each.id === id);
    return view === undefined ? null : agentIn(view.kind, this.viewAgents.get(id)?.agent) ?? null;
  }
  subagentsOf(id, canvas) {
    const node = this.nodes.get(id);
    const kind = node?.kind ?? this.views.find((each) => each.id === id)?.kind;
    const subagents = node === undefined ? this.viewAgents.get(id)?.subagents : node.viewId === canvas ? node.subagents : undefined;
    if (kind !== "chat" && kind !== "design") {
      return [];
    }
    return (subagents ?? []).map((each) => ({ status: each.status ?? "running", node: each.node === undefined ? null : { id: each.node } }));
  }
  setAgent(id, agent) {
    const { subagents, ...info } = agent ?? {};
    const next = agent === null ? {} : { agent: info, ...subagents === undefined ? {} : { subagents } };
    const node = this.nodes.get(id);
    if (node !== undefined) {
      const { agent: _agent, subagents: _subagents, ...rest } = node;
      this.nodes.set(id, { ...rest, ...next });
    } else if (this.views.some((each) => each.id === id)) {
      this.viewAgents.set(id, next);
    } else {
      throw new Error(`No node or view ${id}`);
    }
    this.changed();
  }
  nodesInFront() {
    return [...this.nodes.values()].filter((node) => node.viewId === this.activeViewId).map((node) => this.info(node.id));
  }
  baseContext() {
    const view = this.views.find((each) => each.id === this.activeViewId);
    return {
      project: { id: this.project?.id ?? "", name: this.project?.name ?? "", folder: this.project?.folder ?? null },
      view: view === undefined ? null : { ...view },
      machine: { id: this.machineId },
      theme: this.theme
    };
  }
  context(place, extra = {}) {
    if (!isExtensionSlotName(place)) {
      throw new TypeError(`${place} is no slot. The slots are ${EXTENSION_SLOT_NAMES.join(", ")}`);
    }
    const current = (value) => {
      if (Array.isArray(value)) {
        return value.map(current);
      }
      if (typeof value === "string") {
        return this.info(value);
      }
      return typeof value === "object" && value !== null && typeof value.id === "string" ? this.info(value.id) : value;
    };
    const told = Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, NODE_PLACES.includes(key) ? current(value) : value]));
    const selected = () => this.selection.map((id) => this.info(id));
    const defaults = {};
    if (place === "selectionBar" || place === "commandPalette") {
      defaults.nodes = selected();
    }
    if (place === "canvasMenu") {
      defaults.at = { x: 0, y: 0 };
    }
    if (place === "nodeMenu" && told.node !== undefined && told.nodes === undefined) {
      const { id } = told.node;
      defaults.nodes = this.selection.includes(id) ? selected() : [told.node];
    }
    return { ...this.baseContext(), ...defaults, ...told };
  }
  shown(entry, place, context) {
    const slot = entry.slots[place];
    if (slot === undefined) {
      return null;
    }
    try {
      const answer = slot === true ? true : slot(context);
      if (answer === false) {
        return null;
      }
      const details = answer === true ? {} : answer;
      return {
        title: details.title ?? entry.title,
        icon: details.icon ?? entry.icon ?? null,
        disabled: details.disabled ?? false,
        badge: details.badge ?? null,
        order: details.order ?? 0
      };
    } catch (e) {
      this.logs.push(`${entry.id}: ${errorText(e)}`);
      return null;
    }
  }
  entry(definition) {
    const entry = this.entryOf.get(definition);
    if (entry === undefined) {
      throw new TypeError("This is no action, menu, widget or node the extension defined. Take one from host.action(id) and its kind");
    }
    return entry;
  }
  async runEntry(entry, title, context, slot) {
    const nodeIds = (context.nodes ?? (context.node === undefined ? [] : [context.node])).map((node) => node.id);
    const run = entry.run;
    const busy = this.runs.some((each) => each.actionId === entry.id && (nodeIds.length === 0 || each.nodeIds.length === 0 || each.nodeIds.some((id) => nodeIds.includes(id))));
    if (run === undefined || busy) {
      return { ok: false, error: { code: "refused", message: `${title} is running on these nodes already` } };
    }
    const tracked = { actionId: entry.id, nodeIds };
    this.runs.push(tracked);
    this.changed();
    try {
      await run({ ...context, slot, signal: new AbortController().signal });
      return { ok: true, value: undefined };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return { ok: true, value: undefined };
      }
      const message = errorText(e);
      this.notifications.push({ text: title, detail: message, tone: "error" });
      this.logs.push(`${entry.id.slice(this.id.length + 1)}: ${message}`);
      return { ok: false, error: { code: "failed", message } };
    } finally {
      this.runs.splice(this.runs.indexOf(tracked), 1);
      this.changed();
    }
  }
  slot(definition, place, extra) {
    const context = this.context(place, extra);
    return this.shown(this.entry(definition), place, context);
  }
  async run(definition, place, extra) {
    const context = this.context(place, extra);
    const entry = this.entry(definition);
    const shown = this.shown(entry, place, context);
    if (shown === null) {
      return { ok: false, error: { code: "refused", message: `${entry.title} does not show in ${place} here` } };
    }
    if (shown.disabled !== false) {
      return {
        ok: false,
        error: { code: "refused", message: typeof shown.disabled === "string" ? shown.disabled : `${shown.title} is disabled in ${place} here` }
      };
    }
    return this.runEntry(entry, shown.title, context, place);
  }
  menuItems(menu, place, extra) {
    const context = this.context(place, extra);
    const entry = this.entry(menu);
    if (entry.kind !== "menu") {
      throw new TypeError(`${entry.title} is no menu`);
    }
    if (this.shown(entry, place, context) === null) {
      return { ok: false, error: { code: "refused", message: `${entry.title} does not show in ${place} here` } };
    }
    try {
      const items = typeof entry.items === "function" ? entry.items(context) : entry.items ?? [];
      return { ok: true, value: this.rows(items, context, place) };
    } catch (e) {
      const message = errorText(e);
      this.logs.push(`${entry.id.slice(this.id.length + 1)}: ${message}`);
      return { ok: false, error: { code: "failed", message } };
    }
  }
  rows(items, context, place) {
    return items.flatMap((item) => {
      if (item === "separator") {
        return ["separator"];
      }
      if (typeof item === "object" && item !== null && "actionId" in item) {
        const action = this.entries.find((each) => each.id === item.actionId);
        return action === undefined ? [] : [{ title: action.title, run: () => this.runEntry(action, action.title, context, place) }];
      }
      const row = item;
      if (row.items !== undefined) {
        return [{ title: row.title, items: this.rows(row.items, context, place) }];
      }
      return [
        {
          title: row.title,
          ...row.checked === undefined ? {} : { checked: row.checked },
          run: async () => {
            try {
              row.run?.();
              return { ok: true, value: undefined };
            } catch (e) {
              return { ok: false, error: { code: "failed", message: errorText(e) } };
            }
          }
        }
      ];
    });
  }
  ask(kind, title, answer, body) {
    this.dialogs.push({ kind, title, ...body === undefined ? {} : { body }, answer });
    return answer;
  }
}

// apps/server/src/extensions/test-client.ts
var ARRANGE_GAP = 40;
function assertLazy(surface, what) {
  const problem = lazyComponentProblem(surface, what);
  if (problem !== null) {
    throw new TypeError(problem);
  }
}
function useHost(host) {
  react().useSyncExternalStore((listener) => host.subscribe(listener), () => host.snapshot());
}
function overlaps(bounds, area) {
  return bounds.x < area.x + area.width && area.x < bounds.x + bounds.width && bounds.y < area.y + area.height && area.y < bounds.y + bounds.height;
}
function useSurfaceCanvas(host) {
  const module = react();
  const nodeId = module.useContext(nodeContextOf(module));
  return (nodeId === null ? undefined : host.nodes.get(nodeId)?.viewId) ?? host.activeViewId ?? "";
}
function removeTitle(count) {
  return count === 1 ? "Remove 1 node?" : `Remove ${count} nodes?`;
}
function removeBody(count, name) {
  return count === 1 ? `${name} asks to remove it.` : `${name} asks to remove them.`;
}
async function serverCall(host, method, args) {
  const server = host.answers.server;
  if (server !== undefined && typeof server.call === "function" && "asked" in server) {
    const result = await server.call(method, ...args);
    host.calls.push({ method: `server ${method}`, args, result });
    if (!result.ok) {
      host.logs.push(`server ${method}: ${result.error.code}: ${result.error.message}`);
    }
    return result;
  }
  return host.settle(`server ${method}`, args, async () => {
    try {
      return wire2(await callHandler(server ?? {}, method, wire2(args))) ?? null;
    } catch (e) {
      if (e instanceof MissingHandler) {
        throw new Refused("not-found", e.message);
      }
      throw e instanceof TypeError ? new Error(e.message) : e;
    }
  });
}
function serverClient(host) {
  return new Proxy({}, {
    get(_target, method) {
      if (typeof method !== "string") {
        return;
      }
      return Object.assign((...args) => serverCall(host, method, args), {
        use(...args) {
          const key = JSON.stringify([method, args]);
          let pending = host.serverCache.get(key);
          if (pending === undefined) {
            pending = serverCall(host, method, args);
            host.serverCache.set(key, pending);
          }
          return react().use(pending);
        },
        reload(...args) {
          if (host.serverCache.delete(JSON.stringify([method, args]))) {
            host.changed();
          }
        }
      });
    }
  });
}
function machineCalls(host, area, names) {
  return Object.fromEntries(names.map((action) => {
    const verb = action.slice(action.indexOf(".") + 1);
    const path = `${area}.${verb}`;
    return [
      verb,
      (input = {}) => host.settle(path, [input], async () => {
        const project = host.projectId();
        const parsed = parseExtensionActionInput(action, wire2(input));
        if (!parsed.ok) {
          throw new TypeError(`${path}: ${parsed.message}`);
        }
        const run = host.answers["machine.run"]?.[action];
        if (run === undefined) {
          throw new Refused("unavailable", `Nothing answers ${action} in this test. Give it under answers['machine.run']`);
        }
        return wire2(await run(parsed.input, { id: project }));
      })
    ];
  }));
}
function nodeText(host, id, kind) {
  host.projectId();
  const chat = kind === "chat" ? host.chats.get(id) : undefined;
  if (chat !== undefined) {
    return chat.text;
  }
  const node = host.nodes.get(id);
  if (node?.kind !== kind) {
    throw new Refused("not-found", `No ${kind} ${id} in this project`);
  }
  return node.text;
}
function settingDefault(host, key) {
  for (const { kind, definition } of host.definitions) {
    if (kind !== "settings") {
      continue;
    }
    const settings = definition;
    const field = (settings.fields ?? settings.groups?.flatMap((group) => group.fields) ?? []).find((each) => each.key === key);
    if (field !== undefined) {
      return field.default;
    }
  }
  return;
}
function ask(answer, options, fallback) {
  if (typeof answer === "function") {
    return answer(options);
  }
  return answer === undefined ? fallback : answer;
}
function iteratorOf(pieces) {
  return Symbol.asyncIterator in pieces ? pieces[Symbol.asyncIterator]() : pieces[Symbol.iterator]();
}
function clientApi(host) {
  const fullId = (id) => `${host.id}/${id}`;
  const inFolder = (what, path, args) => host.settle(what, args, () => {
    host.inProject(path);
    return host.scripted(what, args);
  });
  const entry = (definition, details) => host.addEntry(definition, { ...details, slots: details.slots ?? {} });
  const actionHandle = (id) => ({
    actionId: id,
    run: async (context) => {
      const found = host.entries.find((each) => each.id === id);
      if (found !== undefined) {
        await host.runEntry(found, found.title, { ...host.baseContext(), ...context }, "code");
      }
    },
    useRunning: () => {
      useHost(host);
      return host.runs.some((run) => run.actionId === id);
    }
  });
  return {
    definePanel(panel) {
      assertLazy(panel, `definePanel ${panel.id}`);
      host.record("panel", panel);
      host.panels[panel.id] = { title: panel.title, badge: null, open: false, params: undefined };
      const state = () => host.panels[panel.id];
      return {
        open: (params) => {
          Object.assign(state(), { open: true, params });
          host.opened.push({ kind: "panel", id: panel.id, params });
          host.changed();
        },
        close: () => {
          state().open = false;
          host.changed();
        },
        setBadge: (text) => {
          state().badge = text;
          host.changed();
        },
        setTitle: (title) => {
          state().title = title;
          host.changed();
        }
      };
    },
    defineSidebarCard(card) {
      assertLazy(card, `defineSidebarCard ${card.id}`);
      host.record("sidebarCard", card);
    },
    defineView(view) {
      assertLazy(view, `defineView ${view.id}`);
      host.record("view", view);
      return {
        open: (params) => {
          const { id } = host.addView("unknown", view.title);
          host.opened.push({ kind: "view", id: view.id, params });
          host.openView(id);
        }
      };
    },
    defineNode(node) {
      assertLazy(node, `defineNode ${node.id}`);
      host.record("node", node);
      entry(node, {
        id: fullId(`node/${node.id}`),
        kind: "action",
        title: node.title,
        ...node.icon === undefined ? {} : { icon: node.icon },
        slots: node.addFrom ?? { canvasMenu: true, commandPalette: true },
        run: (context) => {
          host.addNode("extension", context.at ?? { x: 0, y: 0 }, {
            title: node.title,
            extension: { id: host.id, type: node.id },
            data: wire2(node.initialData ?? {}),
            ...node.dataVersion === undefined ? {} : { dataVersion: node.dataVersion }
          }, node.size ?? NEW_NODE);
        }
      });
    },
    defineCanvasOverlay(overlay) {
      assertLazy(overlay, `defineCanvasOverlay ${overlay.id}`);
      if (overlay.space !== undefined && overlay.space !== "screen" && overlay.space !== "canvas") {
        throw new TypeError(`defineCanvasOverlay ${overlay.id}: space is screen or canvas`);
      }
      host.record("canvasOverlay", overlay);
    },
    defineFileViewer(viewer) {
      assertLazy(viewer, `defineFileViewer ${viewer.id}`);
      host.record("fileViewer", viewer);
    },
    defineMarkdownBlock(block) {
      assertLazy(block, `defineMarkdownBlock ${block.language}`);
      host.record("markdownBlock", block);
    },
    defineOverlay(overlay) {
      assertLazy(overlay, `defineOverlay ${overlay.id}`);
      host.record("overlay", overlay);
      return {
        open: async (params) => {
          host.opened.push({ kind: "overlay", id: overlay.id, params });
          const answer = host.answers.overlays?.[overlay.id];
          return answer === undefined ? null : await answer(params) ?? null;
        },
        close: () => {
          return;
        }
      };
    },
    defineToolResult(result) {
      assertLazy(result, `defineToolResult ${result.id}`);
      host.record("toolResult", result);
    },
    definePaletteSource: (source) => host.record("paletteSource", source),
    defineSlashCommand: (command) => host.record("slashCommand", command),
    defineReference: (reference) => host.record("reference", reference),
    defineDiffViewer(viewer) {
      assertLazy(viewer, `defineDiffViewer ${viewer.id}`);
      host.record("diffViewer", viewer);
    },
    defineFileIcon: (icon) => host.record("fileIcon", icon),
    defineVoiceAction: (action) => host.record("voiceAction", action),
    defineTemplate(template) {
      host.record("template", template);
      entry(template, {
        id: fullId(`template/${template.id}`),
        kind: "action",
        title: template.title,
        ...template.icon === undefined ? {} : { icon: template.icon },
        slots: { canvasMenu: true },
        run: template.create
      });
    },
    defineCommand: (command) => host.record("command", command),
    defineExtensionSettings(settings) {
      if (settings.fields === undefined && settings.groups === undefined) {
        assertLazy(settings, `defineExtensionSettings ${host.id}`);
      }
      const { section } = settings;
      if (section !== undefined && section.group !== "workspace" && section.group !== "ai") {
        throw new TypeError(`defineExtensionSettings ${host.id}: a section stands in the group workspace or ai`);
      }
      if (section !== undefined) {
        host.logs.push("defineExtensionSettings: a section of its own in the settings is for the extensions Ruimte ships; this page stays under Extensions");
      }
      host.record("settings", settings);
    },
    defineAction(action) {
      const problem = action.shortcut === undefined ? null : shortcutProblem(action.shortcut);
      if (problem !== null) {
        throw new Error(problem);
      }
      host.record("action", action);
      entry(action, {
        id: fullId(action.id),
        kind: "action",
        title: action.title,
        ...action.icon === undefined ? {} : { icon: action.icon },
        slots: action.slots ?? {},
        run: action.run
      });
      return actionHandle(fullId(action.id));
    },
    defineMenu(menu) {
      host.record("menu", menu);
      entry(menu, {
        id: fullId(menu.id),
        kind: "menu",
        title: menu.title,
        ...menu.icon === undefined ? {} : { icon: menu.icon },
        slots: menu.slots,
        items: menu.items
      });
    },
    defineWidget(widget) {
      assertLazy(widget, `defineWidget ${widget.id}`);
      host.record("widget", widget);
      entry(widget, { id: fullId(widget.id), kind: "widget", title: widget.id, slots: widget.slots });
    },
    useServer: () => {
      useHost(host);
      return serverClient(host);
    },
    getServer: () => serverClient(host),
    useServerEvent(name, listener) {
      react().useEffect(() => host.listen(`server:${name}`, listener), [name, listener]);
    },
    useUsageLimits() {
      host.hookPermission("useUsageLimits");
      return host.answers["usage.limits"] ?? [];
    },
    useNodeData() {
      const module = react();
      const nodeId = module.useContext(nodeContextOf(module));
      useHost(host);
      if (nodeId === null) {
        throw new Error("useNodeData only works in a node");
      }
      return [host.nodes.get(nodeId)?.data, (next) => host.changeNode(nodeId, { data: wire2(next) })];
    },
    useStorage(key, initial, scope = "computer") {
      useHost(host);
      const values = host.storage[scope];
      return [
        Object.hasOwn(values, key) ? values[key] : initial,
        (next) => {
          if (next === undefined) {
            delete values[key];
          } else {
            values[key] = wire2(next);
          }
          host.changed();
        }
      ];
    },
    useProject: () => {
      useHost(host);
      return { id: host.project?.id ?? "", name: host.project?.name ?? "" };
    },
    useActiveView: () => {
      useHost(host);
      return { id: host.activeViewId ?? "" };
    },
    useViews: () => {
      useHost(host);
      return host.views.map((view) => ({ ...view }));
    },
    useSelection: () => {
      useHost(host);
      return host.selection.map((id) => host.info(id));
    },
    useSetting(key) {
      useHost(host);
      return Object.hasOwn(host.settings, key) ? host.settings[key] : settingDefault(host, key);
    },
    useMachine: () => ({ id: host.machineId }),
    useTheme: () => ({ side: host.theme }),
    useChat(chatId) {
      useHost(host);
      const chat = host.chats.get(chatId);
      if (chat === undefined) {
        return null;
      }
      const agent = host.nodes.has(chatId) ? host.info(chatId).agent : undefined;
      return {
        id: chatId,
        provider: agent?.provider ?? chat.provider,
        status: agent?.status ?? chat.status,
        model: null,
        cwd: agent?.cwd ?? host.project?.folder ?? ""
      };
    },
    Chat({ id }) {
      host.hookPermission("Chat");
      useHost(host);
      const chat = host.chats.get(id);
      return react().createElement("section", { "aria-label": chat?.title ?? id }, chat === undefined ? `No chat ${id}` : chat.text);
    },
    useNode: (id) => {
      useHost(host);
      const canvas = useSurfaceCanvas(host);
      return host.nodes.get(id)?.viewId === canvas ? host.info(id) : host.unknownNode(id, canvas);
    },
    useNodes: (filter) => {
      useHost(host);
      const nodes = host.nodesInFront();
      return filter === undefined ? nodes : nodes.filter(filter);
    },
    useLocale() {
      const { words } = host;
      return {
        language: host.language,
        get format() {
          const format = formatModule();
          format.setFormatSource({ language: () => host.language, region: () => format.FORMAT_LANGUAGE, subscribe: () => () => {
            return;
          } });
          return format;
        },
        t: (key, values) => extensionWord(words, host.language, key, values)
      };
    },
    useEvent(name, listener) {
      react().useEffect(() => host.listen(name, listener), [name, listener]);
    },
    onEvent: (name, listener) => host.listen(name, listener),
    useAgents() {
      host.hookPermission("useAgents");
      useHost(host);
      return host.nodesInFront().filter((node) => node.kind === "chat" || node.kind === "terminal").map((node) => ({ id: node.id, title: node.title, status: node.agent?.status ?? "idle" }));
    },
    useAgent(target) {
      host.hookPermission("useAgent");
      useHost(host);
      return host.agentOf(target.id, useSurfaceCanvas(host));
    },
    useSubagents(chat) {
      host.hookPermission("useSubagents");
      useHost(host);
      return host.subagentsOf(chat.id, useSurfaceCanvas(host));
    },
    useProviders() {
      useHost(host);
      return host.providers.map((provider) => ({ ...provider }));
    },
    storage: {
      get(key) {
        const values = host.storage.computer;
        return Object.hasOwn(values, key) ? values[key] : undefined;
      },
      set: (key, value) => host.attempt("storage.set", [key, value], () => {
        host.storage.computer[key] = wire2(value);
        host.changed();
      }),
      delete: (key) => host.attempt("storage.delete", [key], () => {
        delete host.storage.computer[key];
        host.changed();
      }),
      watch(key, listener) {
        let text = JSON.stringify(host.storage.computer[key] ?? null);
        return host.subscribe(() => {
          const next = JSON.stringify(host.storage.computer[key] ?? null);
          if (next !== text) {
            text = next;
            listener();
          }
        });
      }
    },
    useCanvasView(select) {
      useHost(host);
      return select(host.canvasView);
    },
    useInView(node) {
      useHost(host);
      const canvas = useSurfaceCanvas(host);
      const found = host.nodes.get(node.id);
      return found !== undefined && found.viewId === canvas && overlaps(found.bounds, host.canvasView.visible);
    },
    nodeColorValue(color) {
      const value = NODE_ACCENT_COLORS[color];
      if (value === undefined) {
        throw new TypeError(`nodeColorValue: ${String(color)} is no accent of Ruimte`);
      }
      return value;
    },
    host: {
      async busy(work, run) {
        const tracked = { actionId: null, nodeIds: (work.nodes ?? []).map((node) => node.id) };
        host.runs.push(tracked);
        host.changed();
        try {
          return await run(new AbortController().signal);
        } finally {
          host.runs.splice(host.runs.indexOf(tracked), 1);
          host.changed();
        }
      },
      notify(text, options) {
        host.notifications.push({ text, tone: options?.tone ?? "neutral", ...options?.action === undefined ? {} : { action: options.action.title } });
      },
      pickFolder: async (initial) => host.ask("folder", initial ?? "", host.answers.pickFolder ?? null),
      openSettings() {
        host.opened.push({ kind: "settings" });
      },
      confirm: async (options) => host.ask("confirm", options.title, ask(host.answers.confirm, options, true), options.body),
      prompt: async (options) => host.ask("prompt", options.title, ask(host.answers.prompt, options, null)),
      async pick(options) {
        const labels = options.items.map(options.label);
        const answer = host.ask("pick", options.title, ask(host.answers.pick, { title: options.title, labels }, null));
        return answer === null ? null : options.items[labels.indexOf(answer)] ?? null;
      },
      openUrl(url) {
        host.opened.push({ kind: "url", id: url });
      },
      copy(text) {
        host.copied.push(text);
      }
    },
    files: {
      readText: (path) => inFolder("files.readText", path, [path]),
      write: (path, text) => host.settle("files.write", [path, text], async () => {
        host.inProject(path);
        await host.scripted("files.write", [path, text]);
      }),
      list: (folder) => inFolder("files.list", folder, [folder]),
      watch: (path, listener) => host.attempt("files.watch", [path], () => {
        const watch = { path: host.inProject(path), listener };
        host.watches.add(watch);
        return () => {
          host.watches.delete(watch);
        };
      }),
      open(path) {
        host.opened.push({ kind: "file", id: path });
      }
    },
    git: {
      status: (options = {}) => inFolder("git.status", options.repository ?? ".", [options]),
      diff: (options) => inFolder("git.diff", options.repository ?? ".", [options]),
      log: (options = {}) => inFolder("git.log", options.repository ?? ".", [options])
    },
    launches: machineCalls(host, "launches", [
      "launch.list",
      "launch.read",
      "launch.start",
      "launch.restart",
      "launch.stop"
    ]),
    routines: machineCalls(host, "routines", ["routine.list", "routine.run", "routine.pause", "routine.resume"]),
    artifacts: machineCalls(host, "artifacts", ["artifact.list", "artifact.read", "artifact.publish"]),
    browser: machineCalls(host, "browser", [
      "browser.inspect",
      "browser.navigate",
      "browser.back",
      "browser.forward",
      "browser.reload",
      "browser.screenshot"
    ]),
    devices: machineCalls(host, "devices", [
      "device.list",
      "device.inspect",
      "device.screenshot",
      "device.tap",
      "device.launch"
    ]),
    terminals: {
      read: (terminal) => host.settle("terminals.read", [terminal], () => host.scripted("terminals.read", [terminal], () => nodeText(host, terminal.id, "terminal"))),
      open: (options = {}) => host.attempt("terminals.open", [options], () => host.addNode("terminal", host.beside(options.near), {
        ...options.title === undefined ? {} : { title: options.title },
        ...options.cwd === undefined ? {} : { path: options.cwd }
      }))
    },
    database: {
      connections: () => host.settle("database.connections", [], () => host.scripted("database.connections", [])),
      query: (connection, sql) => host.settle("database.query", [connection, sql], () => {
        host.projectId();
        return host.scripted("database.query", [connection, sql]);
      })
    },
    chats: {
      list: () => host.settle("chats.list", [], () => host.scripted("chats.list", [])),
      read: (chatId) => host.settle("chats.read", [chatId], () => host.scripted("chats.read", [chatId], () => nodeText(host, chatId, "chat"))),
      send: (chatId, text) => host.settle("chats.send", [chatId, text], async () => {
        await host.scripted("chats.send", [chatId, text]);
      })
    },
    views: {
      open(view) {
        host.openView(view.id);
      },
      focus(view) {
        host.focused.push(view.id);
      },
      createCanvas: (name) => host.attempt("views.createCanvas", [name], () => {
        host.projectId();
        const view = host.addView("canvas", name);
        host.openView(view.id);
        return view;
      }),
      rename: (view, name) => host.attempt("views.rename", [view, name], () => {
        const found = host.views.find((each) => each.id === view.id);
        if (found === undefined) {
          throw new Refused("not-found", `No view ${view.id} in this project`);
        }
        found.name = name;
        host.changed();
      })
    },
    context: {
      read: (of) => host.settle("context.read", [of], () => {
        host.projectId();
        return host.scripted("context.read", [of], () => {
          const selects = contextSelection({ nodeIds: of.nodes?.map((node) => node.id), viewId: of.view?.id });
          return [...host.nodes.values()].filter((node) => selects(node.id, node.viewId)).map((node) => ({ id: node.id, kind: node.kind, title: node.title, text: node.text }));
        });
      })
    },
    agents: {
      run: (options) => host.settle("agents.run", [options], () => {
        host.projectId();
        return host.scripted("agents.run", [options]);
      }),
      async* stream(options) {
        const { signal, ...asked } = options;
        const refused = () => {
          try {
            host.permitCall("agents.stream");
            host.projectId();
            return false;
          } catch {
            return true;
          }
        };
        if (signal?.aborted === true && !refused()) {
          return;
        }
        const stop = new AbortController;
        const stopRun = () => stop.abort(signal?.reason);
        const stopped = new Promise((resolve) => {
          stop.signal.addEventListener("abort", () => resolve("stopped"), { once: true });
        });
        const answer = host.answers["agents.stream"];
        const close = (iterator) => {
          Promise.resolve(iterator.return?.()).catch(() => {
            return;
          });
        };
        let source = null;
        signal?.addEventListener("abort", stopRun);
        try {
          const starting = host.settle("agents.stream", [asked], () => {
            host.projectId();
            if (typeof answer !== "function") {
              return host.scripted("agents.stream", [asked]);
            }
            return answer({ ...wire2(asked), signal: stop.signal });
          });
          const pieces = await Promise.race([starting, stopped]);
          if (pieces === "stopped") {
            starting.then((late) => {
              if (late.ok) {
                close(iteratorOf(late.value));
              }
            }, () => {
              return;
            });
            return;
          }
          if (!pieces.ok) {
            yield pieces;
            return;
          }
          source = iteratorOf(pieces.value);
          while (!stop.signal.aborted) {
            let next;
            try {
              next = await Promise.race([source.next(), stopped]);
            } catch (e) {
              yield host.failure("agents.stream", [asked], e);
              return;
            }
            if (next === "stopped" || next.done === true || stop.signal.aborted) {
              return;
            }
            yield { ok: true, value: { text: String(next.value) } };
          }
        } finally {
          signal?.removeEventListener("abort", stopRun);
          stop.abort();
          if (source !== null) {
            close(source);
          }
        }
      },
      start: (options) => host.settle("agents.start", [options], () => {
        host.projectId();
        return host.scripted("agents.start", [options], () => {
          const title = options.title ?? "Chat";
          const provider = options.provider ?? "claude";
          const hidden = options.hidden === true;
          if (options.folder !== undefined) {
            if (options.folder !== host.project?.folder) {
              throw new Refused("not-found", `No project in ${options.folder} on this machine`);
            }
            return host.addChatView(title, provider, hidden);
          }
          if (hidden) {
            return host.addChatView(title, provider, true);
          }
          if (host.views.find((view) => view.id === host.activeViewId)?.kind !== "canvas") {
            return host.addChatView(title, provider);
          }
          const created = host.addNode("chat", host.beside(options.near), { title, agent: { provider, status: "running" } });
          host.chats.set(created.id, { id: created.id, title, text: "", provider, status: "running" });
          return created;
        });
      })
    },
    canvas: {
      createNote: (note) => host.attempt("canvas.createNote", [note], () => {
        const created = host.addNode("note", host.beside(note.near), {
          ...note.title === undefined ? {} : { title: note.title },
          text: note.text,
          color: note.color ?? null
        });
        host.notes.push(created.id);
        return created;
      }),
      createFile: (path, options = {}) => host.attempt("canvas.createFile", [path, options], () => host.addNode("file", host.beside(options.near), { path })),
      createBrowser: (url, options = {}) => host.attempt("canvas.createBrowser", [url, options], () => host.addNode("browser", host.beside(options.near), { url })),
      createNode: (type, options = {}) => {
        const node = host.definitions.find((each) => each.kind === "node" && each.definition.id === type);
        if (node === undefined) {
          throw new TypeError(`${host.name} has no node ${type}`);
        }
        const defined = node.definition;
        return host.attempt("canvas.createNode", [type, options], () => host.addNode("extension", options.near === undefined ? { x: 0, y: 0 } : host.beside(options.near), {
          title: options.title ?? defined.title,
          extension: { id: host.id, type },
          data: wire2(options.data ?? defined.initialData ?? {}),
          ...defined.dataVersion === undefined ? {} : { dataVersion: defined.dataVersion }
        }, defined.size ?? NEW_NODE));
      },
      update: (node, patch) => host.attempt("canvas.update", [node, patch], () => {
        const { bounds, title } = host.nodeOnCanvas(node);
        host.changeNode(node.id, {
          title: patch.title ?? title,
          bounds: { x: patch.x ?? bounds.x, y: patch.y ?? bounds.y, width: patch.width ?? bounds.width, height: patch.height ?? bounds.height }
        });
      }),
      writeNote: (node, text) => host.attempt("canvas.writeNote", [node, text], () => {
        host.nodeOnCanvas(node);
        host.changeNode(node.id, { text });
      }),
      arrange: (nodes, layout) => host.attempt("canvas.arrange", [nodes, layout], () => {
        const viewId = host.canvasInFront();
        const placed = nodes.flatMap((node) => {
          const found = host.nodes.get(node.id);
          return found?.viewId === viewId ? [found] : [];
        });
        const first = placed[0];
        if (first === undefined) {
          throw new Refused("not-found", "None of these nodes is on the canvas in front");
        }
        const columns = layout === "row" ? placed.length : layout === "column" ? 1 : Math.ceil(Math.sqrt(placed.length));
        const width = Math.max(...placed.map((node) => node.bounds.width));
        const height = Math.max(...placed.map((node) => node.bounds.height));
        const { x, y } = first.bounds;
        placed.forEach((node, index) => {
          host.changeNode(node.id, {
            bounds: {
              ...node.bounds,
              x: x + index % columns * (width + ARRANGE_GAP),
              y: y + Math.floor(index / columns) * (height + ARRANGE_GAP)
            }
          });
        });
      }),
      remove: (nodes) => host.settle("canvas.remove", [nodes], () => {
        host.canvasInFront();
        const title = removeTitle(nodes.length);
        const body = removeBody(nodes.length, host.name);
        if (!host.ask("confirm", title, ask(host.answers.confirm, { title, body }, true), body)) {
          throw new Refused("refused", "The person kept them");
        }
        host.remove(nodes.map((node) => node.id));
      }),
      group: (nodes) => host.attempt("canvas.group", [nodes], () => {
        const group = host.addGroup(nodes.map((node) => node.id));
        if (group === null) {
          throw new Refused("refused", "These nodes make no group on the canvas in front");
        }
        return group;
      }),
      link: (from, to) => host.attempt("canvas.link", [from, to], () => {
        host.nodeOnCanvas(from);
        host.addEdge(from.id, to.id);
        host.changed();
      }),
      unlink: (from, to) => host.attempt("canvas.unlink", [from, to], () => {
        host.nodeOnCanvas(from);
        const at = host.edges.findIndex((edge) => edge.from === from.id && edge.to === to.id || edge.from === to.id && edge.to === from.id);
        if (at >= 0) {
          host.edges.splice(at, 1);
          host.changed();
        }
      }),
      select(nodes) {
        host.select(nodes.map((node) => node.id));
      },
      reveal(target) {
        host.revealed.push(target.id);
      }
    }
  };
}

// apps/server/src/extensions/test-hosts.ts
var current2 = null;
function currentApi() {
  if (current2 === null) {
    const host = new TestHost({}, process.cwd());
    current2 = { host, api: clientApi(host) };
  }
  return current2.api;
}
function forwarded() {
  const template = clientApi(new TestHost({}, process.cwd()));
  return Object.fromEntries(Object.entries(template).map(([name, member]) => [
    name,
    typeof member === "function" ? (...args) => currentApi()[name](...args) : new Proxy(member, {
      get: (_target, key) => {
        const target = currentApi()[name];
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
    })
  ]));
}
var client = forwarded();
function entryIn(folder, entry) {
  if (entry !== undefined) {
    return resolve2(folder, entry);
  }
  return ["index.ts", "index.tsx"].map((name) => join5(folder, "client", name)).find((path) => existsSync(path)) ?? null;
}
function publicHost(host, api) {
  const created = () => host.createdIds.filter((id) => host.nodes.has(id)).map((id) => host.info(id));
  return {
    definitions: host.definitions,
    action: (id) => host.defined("action", id),
    menu: (id) => host.defined("menu", id),
    widget: (id) => host.defined("widget", id),
    panel: (id) => host.defined("panel", id),
    view: (id) => host.defined("view", id),
    node: (id) => host.defined("node", id),
    card: (id) => host.defined("sidebarCard", id),
    overlay: (id) => host.defined("overlay", id),
    context: (place, extra) => host.context(place, extra),
    slot: (definition, place, extra) => host.slot(definition, place, extra),
    run: (definition, place, extra) => host.run(definition, place, extra),
    menuItems: (menu, place, extra) => host.menuItems(menu, place, extra),
    fire: (name, payload) => host.deliver(name, payload),
    emit: (name, payload) => host.deliver(`server:${name}`, payload),
    select: (ids) => host.select(ids),
    setSetting(key, value) {
      host.settings[key] = value;
      host.changed();
    },
    setAgent: (id, agent) => host.setAgent(id, agent),
    setCanvasView(view) {
      host.canvasView = { ...host.canvasView, ...view, visible: { ...host.canvasView.visible, ...view.visible } };
      host.changed();
    },
    focused: host.focused,
    setStorage(scope, key, value) {
      if (value === undefined) {
        delete host.storage[scope][key];
      } else {
        host.storage[scope][key] = wire2(value);
      }
      host.changed();
    },
    changeFile: (path) => host.changeFile(path),
    reconnect() {
      host.serverCache.clear();
      host.changed();
    },
    render: (drawable, options) => {
      current2 = { host, api };
      if (options?.node !== undefined) {
        host.migrateNode(drawable, options.node);
      }
      return render(drawable, options);
    },
    canvas: {
      nodes: () => host.nodesInFront(),
      notes: () => host.notes.flatMap((id) => {
        const note = host.nodes.get(id);
        return note === undefined ? [] : [{ id, title: note.title, text: note.text, color: note.color }];
      }),
      links: () => host.edges.map((edge) => ({ ...edge })),
      created,
      selection: () => [...host.selection],
      revealed: () => [...host.revealed]
    },
    views: () => host.views.map((view) => ({ ...view, active: view.id === host.activeViewId })),
    notifications: host.notifications,
    dialogs: host.dialogs,
    opened: host.opened,
    panels: host.panels,
    copied: host.copied,
    server: {
      get calls() {
        return host.calls.filter((call) => call.method.startsWith("server "));
      }
    },
    agents: {
      get calls() {
        return host.calls.filter((call) => call.method.startsWith("agents."));
      }
    },
    calls: host.calls,
    storage: host.storage,
    settings: host.settings,
    logs: host.logs
  };
}
var OPTIONS = Object.keys({
  manifest: true,
  entry: true,
  project: true,
  selection: true,
  machine: true,
  theme: true,
  language: true,
  settings: true,
  storage: true,
  providers: true,
  canvas: true,
  answers: true
});
var ANSWERS = Object.keys({
  confirm: true,
  prompt: true,
  pick: true,
  pickFolder: true,
  overlays: true,
  server: true,
  "agents.run": true,
  "agents.stream": true,
  "agents.start": true,
  "chats.list": true,
  "chats.send": true,
  "files.readText": true,
  "files.write": true,
  "files.list": true,
  "git.status": true,
  "git.diff": true,
  "git.log": true,
  "database.connections": true,
  "database.query": true,
  "context.read": true,
  "machine.run": true,
  "usage.limits": true
});
function assertKnownOptions(options) {
  const unknown = Object.keys(options).filter((key) => !OPTIONS.includes(key));
  for (const key of unknown) {
    if (ANSWERS.includes(key)) {
      throw new TypeError(`createTestHost takes ${key} under answers, not beside it`);
    }
  }
  if (unknown.length > 0) {
    throw new TypeError(`createTestHost has no option ${unknown.join(", ")}. It takes ${OPTIONS.join(", ")}`);
  }
  const unanswered = Object.keys(options.answers ?? {}).filter((key) => !ANSWERS.includes(key));
  if (unanswered.length > 0) {
    throw new TypeError(`createTestHost answers nothing under ${unanswered.join(", ")}. It answers ${ANSWERS.join(", ")}`);
  }
}
async function createTestHost(options = {}) {
  assertKnownOptions(options);
  const folder = process.cwd();
  const host = new TestHost(options, folder);
  const api = clientApi(host);
  const entry = entryIn(folder, options.entry);
  current2 = { host, api };
  if (entry !== null) {
    await loadFresh(entry, { "@ruimte/extension/client": api });
  }
  return publicHost(host, api);
}

// apps/server/src/extensions/test-runtime.ts
function through(name) {
  return (...args) => currentServer()[name](...args);
}
function forwarded2(name) {
  return new Proxy({}, {
    get: (_target, key) => {
      const target = currentServer()[name];
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
var server = {
  defineServer: through("defineServer"),
  onEvent: through("onEvent"),
  emit: through("emit"),
  defineNodeContext: through("defineNodeContext"),
  defineAgentTool: through("defineAgentTool"),
  schedule: through("schedule"),
  defineLanguageServer: through("defineLanguageServer"),
  agents: forwarded2("agents"),
  chats: forwarded2("chats"),
  storage: forwarded2("storage"),
  secrets: forwarded2("secrets"),
  machine: forwarded2("machine"),
  log: forwarded2("log")
};
var testing = { createTestHost, createTestServer, refusal };
afterEach(unmountAll);
afterAll(removeTestFolders);
plugin({
  name: "ruimte-extension-fakes",
  setup(build) {
    build.module("@ruimte/extension/client", () => ({ exports: client, loader: "object" }));
    build.module("@ruimte/extension/server", () => ({ exports: server, loader: "object" }));
    build.module("@ruimte/extension/testing", () => ({ exports: testing, loader: "object" }));
    build.module("@ruimte/extension/ui", () => ({ exports: uiModule(), loader: "object" }));
    build.module("@ruimte/extension/charts", () => ({ exports: chartsModule(), loader: "object" }));
    build.module("@ruimte/extension/agents-ui", () => ({ exports: agentsUiModule(), loader: "object" }));
  }
});
