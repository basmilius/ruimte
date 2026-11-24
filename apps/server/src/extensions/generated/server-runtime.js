// @bun
// Generated from apps/server/src/extensions/server-runtime.ts by apps/server/scripts/generate-extension-runtimes.ts. Do not edit.
// apps/server/src/extensions/server-runtime.ts
import { Console } from "console";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

// packages/contracts/src/extension-permissions.ts
var EXTENSION_ACTIONS = {
  "launch.list": "launches.read",
  "launch.read": "launches.read",
  "launch.start": "launches.run",
  "launch.restart": "launches.run",
  "launch.stop": "launches.run",
  "launch.create": "launches.write",
  "launch.edit": "launches.write",
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

// packages/contracts/src/extension-client.ts
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
  "terminals.write": "terminals.write",
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
function missingPermissionMessage(extension, permission) {
  return `${extension} did not ask for the permission ${permission} in its manifest`;
}

// packages/contracts/src/extension-providers.ts
var EXTENSION_PROVIDER_POINTS = {
  terminalProfiles: { define: "defineTerminalProfile", permission: "terminals.profiles", proposed: true },
  launchSources: { define: "defineLaunchSource", permission: "launches.provide", proposed: true },
  problemSources: { define: "defineProblemSource", permission: "problems.provide", proposed: true },
  hostProviders: { define: "defineHostProvider", permission: "hosts.provide", proposed: true }
};
var EXTENSION_PROPOSED_PARTS = Object.keys(EXTENSION_PROVIDER_POINTS).filter((kind) => EXTENSION_PROVIDER_POINTS[kind]?.proposed === true);
function pointOf(kind) {
  return Object.hasOwn(EXTENSION_PROVIDER_POINTS, kind) ? EXTENSION_PROVIDER_POINTS[kind] ?? null : null;
}
function providerPointOf(define) {
  const kind = Object.keys(EXTENSION_PROVIDER_POINTS).find((each) => EXTENSION_PROVIDER_POINTS[each]?.define === define);
  const point = kind === undefined ? null : pointOf(kind);
  return kind === undefined || point === null ? null : { kind, point };
}
function providerRefusal(manifest, define, id, proposedAllowed) {
  const found = providerPointOf(define);
  if (found === null) {
    return `${define} registers nothing this Ruimte takes from an extension`;
  }
  const { kind, point } = found;
  if (point.proposed && !(manifest.proposed ?? []).includes(kind)) {
    return `${define} is still proposed; name ${kind} under proposed in manifest.json`;
  }
  if (point.proposed && !proposedAllowed) {
    return `${define} is still proposed, which an installed extension cannot use`;
  }
  return (manifest.provides?.[kind] ?? []).includes(id) ? null : `${define} got ${id}, which manifest.json does not list under provides.${kind}`;
}

// apps/server/src/extensions/policy.ts
var STORAGE_ASKS = new Set(["storage.get", "storage.set", "storage.delete"]);
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
function parseKeyValues(text) {
  try {
    const values = JSON.parse(text);
    return typeof values === "object" && values !== null && !Array.isArray(values) ? values : null;
  } catch {
    return null;
  }
}
function ownValue(values, key) {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}
function callHandler(handlers, method, args) {
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
  if (typeof handler !== "function") {
    throw new MissingHandler(`No method ${method}`);
  }
  return handler(...args);
}
function hostProviderCall(provider, method) {
  const [part, name] = method.includes(".") ? method.split(".") : [null, method];
  const owner = part === null ? provider : provider[part];
  const found = owner === undefined ? undefined : owner[name ?? ""];
  return typeof found === "function" ? found.bind(owner) : undefined;
}
function createServerApi(options) {
  const { ask, send, permissions } = options;
  const listeners = new Map;
  const tools = new Map;
  const nodeContexts = new Map;
  const profiles = new Map;
  const launchSources = new Map;
  const hostProviders = new Map;
  const launchWatches = new Map;
  const fileWatches = new Map;
  let nextFileWatch = 1;
  const typed = (method, args) => ask(method, args);
  const mayDefine = (define, permission, id) => {
    if (!permissions.has(permission)) {
      throw new Error(missingPermissionMessage(options.provides.id, permission));
    }
    const refused = providerRefusal({ ...options.provides, permissions: { [permission]: "" } }, define, id, options.proposedAllowed);
    if (refused !== null) {
      throw new Error(refused);
    }
  };
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
    defineTerminalProfile(profile) {
      mayDefine("defineTerminalProfile", "terminals.profiles", profile.id);
      profiles.set(profile.id, profile);
      send({
        type: "profile",
        id: profile.id,
        title: profile.title,
        ...profile.icon === undefined ? {} : { icon: profile.icon },
        available: profile.available !== undefined
      });
    },
    defineLaunchSource(source) {
      mayDefine("defineLaunchSource", "launches.provide", source.id);
      launchSources.set(source.id, source);
      send({ type: "launchSource", id: source.id, title: source.title, watches: source.watch !== undefined });
    },
    defineProblemSource(source) {
      mayDefine("defineProblemSource", "problems.provide", source.id);
      send({ type: "problemSource", id: source.id, title: source.title });
    },
    defineHostProvider(provider) {
      mayDefine("defineHostProvider", "hosts.provide", provider.id);
      hostProviders.set(provider.id, provider);
      send({
        type: "hostProvider",
        id: provider.id,
        title: provider.title,
        matches: provider.match !== undefined,
        issues: provider.issues !== undefined,
        parses: provider.issues?.parse !== undefined,
        changes: provider.changes !== undefined,
        checks: provider.checks !== undefined
      });
    },
    problems: {
      report: async (project, source, reported) => mapResult(await ask("problems.report", [project.id, source, reported]), () => {
        return;
      }),
      clear: async (project, source) => mapResult(await ask("problems.clear", [project.id, source]), () => {
        return;
      })
    },
    files: {
      readText: (project, path) => typed("files.readText", [project.id, path]),
      list: (project, folder) => typed("files.list", [project.id, folder]),
      async watch(project, path, listener) {
        const watch = nextFileWatch;
        nextFileWatch += 1;
        fileWatches.set(watch, listener);
        const watching = await ask("files.watch", [project.id, path, watch]);
        if (!watching.ok) {
          fileWatches.delete(watch);
          return watching;
        }
        const stop = () => {
          if (fileWatches.delete(watch)) {
            ask("files.unwatch", [watch]);
          }
        };
        return { ok: true, value: stop };
      }
    },
    terminals: {
      read: (terminal) => typed("terminals.read", [terminal.id]),
      async open({ project, profile, title, cwd, near }) {
        const beside = near?.[0]?.id;
        const opened = await typed("terminals.open", [
          {
            projectId: project.id,
            ...profile === undefined ? {} : { profile },
            ...title === undefined ? {} : { title },
            ...cwd === undefined ? {} : { cwd },
            ...beside === undefined ? {} : { beside }
          }
        ]);
        return mapResult(opened, ({ nodeId }) => ({ id: nodeId }));
      },
      write: async (terminal, text) => mapResult(await ask("terminals.write", [terminal.id, text]), () => {
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
    onEvent(name, listener, filter) {
      const group = listeners.get(name) ?? new Set;
      const only = filter?.project?.id;
      const heard = only === undefined ? listener : (payload) => {
        if (payload.project?.id === only) {
          listener(payload);
        }
      };
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
    askProfile(id, method, input) {
      const profile = profiles.get(id);
      if (profile === undefined) {
        throw new MissingHandler(`No terminal profile ${id}`);
      }
      if (method === "available") {
        return profile.available?.(input) ?? true;
      }
      return profile.spawn(input);
    },
    async askLaunchSource(id, method, project) {
      const source = launchSources.get(id);
      if (source === undefined) {
        throw new MissingHandler(`No launch source ${id}`);
      }
      if (method === "list") {
        return source.list(project);
      }
      const key = `${id}
${project.id}`;
      const stop = launchWatches.get(key);
      launchWatches.delete(key);
      stop?.();
      if (method === "watch" && source.watch !== undefined) {
        launchWatches.set(key, await source.watch(project, () => send({ type: "launchesChanged", source: id, projectId: project.id })));
      }
      return null;
    },
    askHostProvider(id, method, args) {
      const provider = hostProviders.get(id);
      if (provider === undefined) {
        throw new MissingHandler(`No host provider ${id}`);
      }
      const asked = hostProviderCall(provider, method);
      if (asked === undefined) {
        throw new MissingHandler(`The host provider ${id} has no ${method}`);
      }
      return asked(...args);
    },
    deliver(name, payload) {
      for (const listener of listeners.get(name) ?? []) {
        listener(payload);
      }
    },
    fileChanged(watch) {
      fileWatches.get(watch)?.();
    }
  };
}

// apps/server/src/extensions/server-runtime.ts
var PRINTING_METHODS = [
  "log",
  "info",
  "debug",
  "dir",
  "dirxml",
  "table",
  "count",
  "countReset",
  "group",
  "groupCollapsed",
  "groupEnd",
  "time",
  "timeLog",
  "timeEnd",
  "trace",
  "assert"
];
var [entry, dataFolder] = process.argv.slice(2);
if (entry === undefined || dataFolder === undefined) {
  throw new Error("Expected the extension entry and its data folder");
}
var folder = dataFolder;
var protocol = process.stdout.write.bind(process.stdout);
function send(message) {
  protocol(`${JSON.stringify(message)}
`);
}
var toStderr = new Console({ stdout: process.stderr, stderr: process.stderr });
for (const name of PRINTING_METHODS) {
  console[name] = toStderr[name].bind(toStderr);
}
process.stdout.write = process.stderr.write.bind(process.stderr);
var asked = new Map;
var nextAsk = 1;
function ask(method, args) {
  const id = nextAsk;
  nextAsk += 1;
  return new Promise((resolve, reject) => {
    asked.set(id, { resolve, reject });
    send({ type: "ask", id, method, args });
  });
}
function jsonFile(name) {
  let text;
  try {
    text = readFileSync(join(folder, name), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      return {};
    }
    throw e;
  }
  const values = parseKeyValues(text);
  if (values === null) {
    throw new Error(`${name} is damaged, so nothing is read or written until it is fixed or removed`);
  }
  return values;
}
function writeJsonFile(name, value) {
  const file = join(folder, name);
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(folder, { recursive: true });
  writeFileSync(temporary, JSON.stringify(value), { mode: 384 });
  renameSync(temporary, file);
}
function secretValues() {
  const name = "secrets.json";
  return {
    get: async (key) => ownValue(jsonFile(name), key),
    set: async (key, value) => writeJsonFile(name, { ...jsonFile(name), [key]: value }),
    async delete(key) {
      const { [key]: _gone, ...rest } = jsonFile(name);
      writeJsonFile(name, rest);
    }
  };
}
function storageValues() {
  const asking = async (method, args) => {
    const answer = await ask(method, args);
    if (!answer.ok) {
      throw new Error(answer.error.message);
    }
    return answer.value;
  };
  return {
    get: async (key) => (await asking("storage.get", [key])).value,
    set: async (key, value) => void await asking("storage.set", [key, value]),
    delete: async (key) => void await asking("storage.delete", [key])
  };
}
var core = createServerApi({
  dataFolder: folder,
  platform: process.platform,
  permissions: new Set(JSON.parse(process.env.RUIMTE_EXTENSION_PERMISSIONS ?? "[]")),
  provides: { id: process.env.RUIMTE_EXTENSION_ID ?? "", ...JSON.parse(process.env.RUIMTE_EXTENSION_PROVIDES ?? "{}") },
  proposedAllowed: process.env.RUIMTE_EXTENSION_PROPOSED === "1",
  ask,
  clock: { every: (ms, run) => void setInterval(run, ms) },
  send,
  storage: storageValues(),
  secrets: secretValues(),
  log: {
    info: (message) => console.error(message),
    error: (message, error) => console.error(message, error ?? "")
  }
});
globalThis.__ruimteExtension = {
  for: () => ({ server: core.server })
};
var { promise: loaded, resolve: resolveLoaded } = Promise.withResolvers();
async function answer(id, run) {
  try {
    send({ type: "result", id, result: await run() ?? null });
  } catch (e) {
    send({ type: "result", id, error: e instanceof Error ? e.message : String(e), ...e instanceof MissingHandler ? { code: "not-found" } : {} });
  }
}
function handle(message) {
  if (message.type === "answer") {
    const waiting = asked.get(message.id);
    const { result, error, code = "failed" } = message;
    asked.delete(message.id);
    if (error === undefined) {
      waiting?.resolve({ ok: true, value: result });
    } else if (code === "invalid-input") {
      waiting?.reject(new TypeError(error));
    } else {
      waiting?.resolve({ ok: false, error: { code, message: error } });
    }
  } else if (message.type === "call") {
    answer(message.id, async () => callHandler(await loaded, message.method, message.args));
  } else if (message.type === "event") {
    core.deliver(message.name, message.payload);
  } else if (message.type === "tool") {
    answer(message.id, async () => {
      await loaded;
      return core.runTool(message.method, message.payload, message.context);
    });
  } else if (message.type === "profile") {
    answer(message.id, async () => {
      await loaded;
      return core.askProfile(message.profile, message.method, message.input);
    });
  } else if (message.type === "launchSource") {
    answer(message.id, async () => {
      await loaded;
      return core.askLaunchSource(message.source, message.method, message.input);
    });
  } else if (message.type === "hostProvider") {
    answer(message.id, async () => {
      await loaded;
      return core.askHostProvider(message.provider, message.method, message.args);
    });
  } else if (message.type === "fileChanged") {
    core.fileChanged(message.watch);
  } else if (message.type === "nodeContext") {
    answer(message.id, async () => {
      await loaded;
      return core.readNodeContext(message.node, message.data);
    });
  }
}
var buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  for (let end = buffered.indexOf(`
`);end >= 0; end = buffered.indexOf(`
`)) {
    const line = buffered.slice(0, end);
    buffered = buffered.slice(end + 1);
    handle(JSON.parse(line));
  }
});
var module = await import(entry);
resolveLoaded(module.default ?? {});
send({ type: "ready" });
