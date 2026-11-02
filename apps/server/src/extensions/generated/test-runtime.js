// @bun
// Generated from apps/server/src/extensions/test-runtime.ts by apps/server/scripts/generate-extension-runtimes.ts. Do not edit.
// apps/server/src/extensions/test-runtime.ts
var {plugin } = globalThis.Bun;

// apps/server/src/extensions/test-client.ts
import { readFileSync } from "fs";
import { createRequire } from "module";
import { join } from "path";
var fromProject = createRequire(import.meta.url);
var defined = [];
var fakeServer = {};
var nodeData = {};
var stored = new Map;
function done(value) {
  return { ok: true, value };
}
function answers(value) {
  return async () => done(value);
}
function failed(e) {
  return { ok: false, error: { code: "failed", message: e instanceof Error ? e.message : String(e) } };
}
function serverAnswer(method, args) {
  const handler = fakeServer[method];
  if (handler === undefined) {
    return { ok: false, error: { code: "not-found", message: `No method ${method}` } };
  }
  try {
    const value = handler(...args);
    return value instanceof Promise ? value.then(done, failed) : done(value);
  } catch (e) {
    return failed(e);
  }
}
function record(kind, definition) {
  defined.push({ kind, definition });
}
function recording(kind) {
  return (definition) => record(kind, definition);
}
function settingDefault(key) {
  for (const { kind, definition } of defined) {
    if (kind !== "settings") {
      continue;
    }
    const settings = definition;
    const fields = settings.fields ?? settings.groups?.flatMap((group) => group.fields) ?? [];
    const field = fields.find((each) => each.key === key);
    if (field !== undefined) {
      return field.default;
    }
  }
  return;
}
function englishWords() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "locales", "en.json"), "utf8"));
  } catch {
    return {};
  }
}
var NO_GIT_STATUS = { repository: false, root: null, branch: null, upstream: null, ahead: 0, behind: 0, files: [], truncated: false };
var NO_BROWSER = (node) => ({ node, open: false, page: null, error: null });
var NO_ARTIFACT = { id: "artifact", title: "", kind: "report", key: null, createdAt: 0 };
var NO_DEVICE = {
  node: { id: "device" },
  device: { name: "", platform: "ios", kind: "simulator", runtime: "" },
  present: false,
  state: null,
  screen: null,
  buttons: [],
  can: { shot: false, input: false, type: false, launch: false }
};
var NODE = { id: "node" };
function launch(input) {
  return { id: input.launch, name: input.launch };
}
function routine(input) {
  return { id: input.routine, title: input.routine };
}
var client = {
  definePanel(panel) {
    record("panel", panel);
    return { open: () => {
      return;
    }, close: () => {
      return;
    }, setBadge: () => {
      return;
    }, setTitle: () => {
      return;
    } };
  },
  defineSidebarCard: recording("sidebarCard"),
  defineView(view) {
    record("view", view);
    return { open: () => {
      return;
    } };
  },
  defineNode: recording("node"),
  defineCanvasOverlay: recording("canvasOverlay"),
  defineFileViewer: recording("fileViewer"),
  defineMarkdownBlock: recording("markdownBlock"),
  defineOverlay(overlay) {
    record("overlay", overlay);
    return { open: async () => null, close: () => {
      return;
    } };
  },
  defineToolResult: recording("toolResult"),
  definePaletteSource: recording("paletteSource"),
  defineSlashCommand: recording("slashCommand"),
  defineReference: recording("reference"),
  defineDiffViewer: recording("diffViewer"),
  defineFileIcon: recording("fileIcon"),
  defineVoiceAction: recording("voiceAction"),
  defineTemplate: recording("template"),
  defineCommand: recording("command"),
  defineExtensionSettings: recording("settings"),
  useSetting: (key) => settingDefault(key),
  useMachine: () => ({ id: "test-machine" }),
  useTheme: () => ({ side: "dark" }),
  useChat: (_id) => null,
  defineAction(action) {
    record("action", action);
    return { run: async () => {
      return;
    }, useRunning: () => false };
  },
  defineMenu: recording("menu"),
  defineWidget: recording("widget"),
  useServer: () => new Proxy({}, {
    get: (_target, method) => Object.assign(async (...args) => serverAnswer(method, args), {
      use: (...args) => serverAnswer(method, args)
    })
  }),
  useServerEvent: (_name, _listener) => {
    return;
  },
  useNodeData: () => [nodeData, (next) => void (nodeData = next)],
  useStorage: (key, initial, scope = "computer") => [
    stored.has(`${scope}:${key}`) ? stored.get(`${scope}:${key}`) : initial,
    (next) => void stored.set(`${scope}:${key}`, next)
  ],
  useProject: () => ({ id: "test-project", name: "Test" }),
  useActiveView: () => ({ id: "test-view" }),
  useViews: () => [],
  useSelection: () => [],
  useNode: (id) => ({
    id,
    kind: "note",
    title: "",
    color: null,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    groupId: null,
    viewId: "test-view",
    machine: null,
    linkedTo: []
  }),
  useNodes: (_filter) => [],
  useLocale() {
    const words = englishWords();
    return {
      language: "en",
      format: {},
      t: (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), words[key] ?? key)
    };
  },
  useEvent: (_name, _listener) => {
    return;
  },
  onEvent: (_name, _listener) => () => {
    return;
  },
  useAgents: () => [],
  useUsageLimits: () => [],
  host: {
    busy: async (_work, run) => run(new AbortController().signal),
    notify: () => {
      return;
    },
    pickFolder: async () => null,
    openSettings: () => {
      return;
    },
    confirm: async () => true,
    prompt: async () => null,
    pick: async () => null,
    openUrl: () => {
      return;
    },
    copy: () => {
      return;
    }
  },
  files: {
    readText: answers(""),
    write: answers(undefined),
    list: answers([]),
    watch: () => done(() => {
      return;
    }),
    open: () => {
      return;
    }
  },
  git: {
    status: answers(NO_GIT_STATUS),
    diff: async ({ path }) => done({ path, diff: "", added: 0, deleted: 0, binary: false, kind: null }),
    log: answers([])
  },
  chats: { list: answers([]), read: answers(""), send: answers(undefined) },
  launches: {
    list: answers({ launches: [] }),
    read: async (input) => done({ ...launch(input), text: null }),
    start: async (input) => done(launch(input)),
    restart: async (input) => done(launch(input)),
    stop: async (input) => done({ ...launch(input), stopping: 0 })
  },
  routines: {
    list: answers({ routines: [] }),
    run: async (input) => done({ ...routine(input), runId: "run" }),
    pause: async (input) => done(routine(input)),
    resume: async (input) => done(routine(input))
  },
  artifacts: {
    list: answers({ artifacts: [] }),
    read: answers({
      artifact: NO_ARTIFACT,
      version: { id: "version", number: 1 },
      file: { name: "", mime: "text/plain", size: 0 },
      text: null,
      truncated: false
    }),
    publish: answers({ artifact: NO_ARTIFACT, version: { id: "version", number: 1 }, existing: false })
  },
  browser: {
    inspect: async ({ node }) => done(NO_BROWSER(node)),
    navigate: async ({ node }) => done(NO_BROWSER(node)),
    back: async ({ node }) => done(NO_BROWSER(node)),
    forward: async ({ node }) => done(NO_BROWSER(node)),
    reload: async ({ node }) => done(NO_BROWSER(node)),
    screenshot: async ({ node }) => done({ ...NO_BROWSER(node), path: null })
  },
  devices: {
    list: answers({ devices: [] }),
    inspect: async ({ node }) => done({ ...NO_DEVICE, node }),
    screenshot: async ({ node }) => done({ node, path: "", width: 0, height: 0 }),
    tap: async ({ node }) => done({ node }),
    launch: async ({ node }) => done({ node })
  },
  terminals: { read: answers(""), open: () => done({ id: "terminal" }) },
  database: {
    connections: answers([]),
    query: answers({ columns: [], rows: [], hasMore: false })
  },
  views: { open: () => {
    return;
  }, createCanvas: () => done({ id: "view" }), rename: () => done(undefined) },
  context: { read: answers([]) },
  agents: {
    run: answers({ text: "" }),
    async* stream() {
      yield done({ text: "" });
    },
    start: answers({ id: "chat" })
  },
  canvas: {
    createNote: () => done(NODE),
    arrange: () => done(undefined),
    remove: answers(undefined),
    createFile: () => done(NODE),
    createBrowser: () => done(NODE),
    createNode: () => done(NODE),
    update: () => done(undefined),
    writeNote: () => done(undefined),
    group: () => done(NODE),
    link: () => done(undefined),
    unlink: () => done(undefined),
    select: () => {
      return;
    },
    reveal: () => {
      return;
    }
  }
};
var clientTesting = {
  definitions: () => defined,
  slotAnswer(definition, slot, context) {
    const answer = definition.slots?.[slot];
    if (typeof answer === "function") {
      return answer(context);
    }
    return answer === true;
  },
  renderSurface(component, options = {}) {
    const { createElement } = fromProject("react");
    const { renderToStaticMarkup } = fromProject("react-dom/server");
    fakeServer = options.server ?? {};
    nodeData = options.data ?? {};
    return renderToStaticMarkup(createElement(component, options.props ?? {}));
  }
};

// apps/server/src/extensions/test-server.ts
import { readFileSync as readFileSync2 } from "fs";
import { tmpdir } from "os";
import { join as join2, resolve } from "path";

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

// packages/contracts/src/extension-results.ts
function extensionAgentStatus(status, needsYou = false) {
  if (needsYou || status === "needs-you") {
    return "needsYou";
  }
  if (status === "running") {
    return "running";
  }
  return status === undefined || status === null || status === "exited" ? "stopped" : "idle";
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
  return { code: "permission-denied", message: `${id} did not ask for the permission ${permission} in its manifest` };
}
function actionRefusal(id, action, permissions) {
  const permission = extensionActionPermission(action);
  if (permission === null) {
    return { code: "not-found", message: `An extension cannot ask for ${action}` };
  }
  return missingPermission(id, permission, permissions);
}
function askRefusal(id, method, args, permissions) {
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
function everyMs(every) {
  const match = /^(\d+)([smh])$/.exec(every);
  const ms = match === null ? 0 : Number(match[1]) * UNITS[match[2]];
  if (ms < MIN_EVERY_MS) {
    throw new Error(`schedule takes something like 30s, 5m or 1h, of at least 10 seconds, not ${every}`);
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
        view,
        near,
        prompt,
        provider,
        title
      }) {
        const beside = near?.[0]?.id;
        const started = await typed("agents.start", [
          {
            projectId: project.id,
            ...view === undefined ? {} : { viewId: view.id },
            ...beside === undefined ? {} : { beside },
            ...prompt === undefined ? {} : { prompt },
            ...provider === undefined ? {} : { provider },
            ...title === undefined ? {} : { title }
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
function failure(code, message) {
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
    return JSON.parse(readFileSync2(join2(folder, "manifest.json"), "utf8"));
  } catch {
    return {};
  }
}
function memory(values) {
  return {
    get: async (key) => Object.hasOwn(values, key) ? wire(values[key]) : undefined,
    set: async (key, value) => {
      values[key] = wire(value);
    },
    delete: async (key) => {
      delete values[key];
    }
  };
}
function startOptions(start) {
  return {
    project: { id: start.projectId },
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
    this.core = createServerApi({
      dataFolder: join2(tmpdir(), `ruimte-extension-test-${this.id}`),
      platform: process.platform,
      permissions: this.permissions,
      ask: (method, args) => this.ask(method, args),
      clock: {
        every: (every, run) => {
          this.scheduled.push({ every, due: this.now + every, run });
        }
      },
      send: (message) => this.said(message),
      storage: memory(this.storage),
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
      const missing = `No tool ${this.id}/${id}. ruimte-context tool list says what there is`;
      throw new Error(this.tools.has(id) ? `${missing}. defineAgentTool needs the permission agents.tools in manifest.json` : missing);
    }
    const answer = await this.core.runTool(id, wire(input), { caller });
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  }
  said(message) {
    if (message.type === "emit") {
      this.emitted.push({ name: message.name, payload: wire(message.payload) });
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
    const [name, recorded] = this.named(method, args);
    const result = refused === null ? await this.answer(method, args) : this.refused(method, refused);
    this.asked.push({ method: name, args: wire(recorded), result });
    return result;
  }
  refused(method, { code, message }) {
    this.logs.push(`${method} answered ${code}: ${message}`);
    return failure(code, message);
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
var loads = 0;
function currentServer() {
  current ??= new TestMachine({}, process.cwd());
  return current.core.server;
}
async function createTestServer(options = {}) {
  const folder = process.cwd();
  const machine = new TestMachine(options, folder);
  loads += 1;
  current = machine;
  const module = await import(`${resolve(folder, options.entry ?? join2("server", "index.ts"))}?ruimte-test=${loads}`);
  const handlers = module.default ?? {};
  const call = async (method, ...args) => {
    try {
      return { ok: true, value: wire(await callHandler(handlers, method, wire(args))) };
    } catch (e) {
      return failure(e instanceof MissingHandler ? "not-found" : "failed", e instanceof Error ? e.message : String(e));
    }
  };
  return {
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
}

// apps/server/src/extensions/test-runtime.ts
function through(name) {
  return (...args) => currentServer()[name](...args);
}
function forwarded(name) {
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
  agents: forwarded("agents"),
  chats: forwarded("chats"),
  storage: forwarded("storage"),
  secrets: forwarded("secrets"),
  machine: forwarded("machine"),
  log: forwarded("log")
};
var testing = { ...clientTesting, createTestServer, refusal };
plugin({
  name: "ruimte-extension-fakes",
  setup(build) {
    build.module("@ruimte/extension/client", () => ({ exports: client, loader: "object" }));
    build.module("@ruimte/extension/server", () => ({ exports: server, loader: "object" }));
    build.module("@ruimte/extension/testing", () => ({ exports: testing, loader: "object" }));
  }
});
