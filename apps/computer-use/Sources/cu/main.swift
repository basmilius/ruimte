import ComputerUseCore
import Foundation

let usage = """
usage: cu <command> [arguments]

  doctor [--no-prompt]                  check Accessibility and Screen Recording;
                                        without --no-prompt it asks macOS for what is missing
  apps                                  list running apps with name, bundle id, pid, frontmost
  open <app>                            launch an app, or bring it to the front (and unhide it)
  state <app>                           accessibility tree of the key window, plus a PNG of it
  click <app> --element N [--count 2] [--button right]
  click <app> --x PX --y PX [--count 2] [--button right]
                                        click an element from the last state, or a screenshot pixel
  scroll <app> (--element N | --x PX --y PX) --direction up|down|left|right [--pages N]
  type <app> <text>                     type text into the focused element
  key <app> <combo> [<combo>...]        press keys: cmd+n, return, escape, tab, shift+tab, up
  set-value <app> --element N <value>   set the AXValue of element N
  menu <app>                            list the menu bar with indices
  menu <app> <index | "File > Save">    run a menu item
  quit                                  stop the agent

Every command takes --home <dir>: the RUIMTE_HOME whose local.key it presents and whose
socket it uses. Without it, RUIMTE_HOME, else ~/.ruimte-dev for the dev app and ~/.ruimte otherwise.

Options for state, and for every action together with --state:
  --state                               after an action, wait for the UI to settle and answer with a new state
  --text                                print the tree as plain text instead of JSON
  --no-screenshot  --max-depth N  --max-elements N  --max-text N

<app> is an app name, a bundle id or a pid (see `cu apps`).
Output is JSON on stdout. On failure the exit code is 1, stdout holds {"error": "..."}
and stderr repeats the message. Put `--` before text that starts with `--`.
"""

let flagNames: Set<String> = ["text", "no-prompt", "no-screenshot", "state", "help"]

struct Arguments {
    var positionals: [String] = []
    var options: [String: String] = [:]
    var flags: Set<String> = []
}

func printJSON(_ object: Any) {
    let options: JSONSerialization.WritingOptions = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: options) else {
        print("{}")
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func printCompactJSON(_ object: Any) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) else {
        return
    }
    print(String(decoding: data, as: UTF8.self))
}

func fail(_ message: String) -> Never {
    printJSON(["error": message])
    FileHandle.standardError.write(Data("cu: \(message)\n".utf8))
    exit(1)
}

func parse(_ tokens: [String]) -> Arguments {
    var result = Arguments()
    var index = 0
    var literal = false
    while index < tokens.count {
        let token = tokens[index]
        index += 1
        if literal || !token.hasPrefix("--") {
            result.positionals.append(token)
            continue
        }
        if token == "--" {
            literal = true
            continue
        }
        let name = String(token.dropFirst(2))
        if flagNames.contains(name) {
            result.flags.insert(name)
            continue
        }
        guard index < tokens.count else {
            fail("--\(name) needs a value")
        }
        result.options[name] = tokens[index]
        index += 1
    }
    return result
}

func intOption(_ arguments: Arguments, _ name: String) -> Int? {
    guard let raw = arguments.options[name] else {
        return nil
    }
    guard let value = Int(raw) else {
        fail("--\(name) expects a whole number, got \"\(raw)\"")
    }
    return value
}

func doubleOption(_ arguments: Arguments, _ name: String) -> Double? {
    guard let raw = arguments.options[name] else {
        return nil
    }
    guard let value = Double(raw), value.isFinite else {
        fail("--\(name) expects a number, got \"\(raw)\"")
    }
    return value
}

func requireApp(_ arguments: Arguments, _ command: String) -> String {
    guard let app = arguments.positionals.first, !app.isEmpty else {
        fail("`cu \(command)` needs an app name, bundle id or pid; see `cu apps`")
    }
    return app
}

func makeRequest(_ command: String, _ arguments: Arguments) -> Request {
    var request = Request(command: command)
    let rest = Array(arguments.positionals.dropFirst())
    request.maxDepth = intOption(arguments, "max-depth")
    request.maxElements = intOption(arguments, "max-elements")
    request.maxText = intOption(arguments, "max-text")
    request.screenshot = !arguments.flags.contains("no-screenshot")
    if arguments.flags.contains("state") {
        request.withState = true
    }
    switch command {
    case "doctor":
        request.prompt = !arguments.flags.contains("no-prompt")
    case "apps", "quit":
        break
    case "state", "open":
        request.app = requireApp(arguments, command)
    case "click", "scroll":
        request.app = requireApp(arguments, command)
        request.element = intOption(arguments, "element")
        request.x = doubleOption(arguments, "x")
        request.y = doubleOption(arguments, "y")
        let hasPoint = request.x != nil && request.y != nil
        if request.element == nil && !hasPoint {
            fail("`cu \(command)` needs --element N, or both --x and --y")
        }
        if request.element != nil && (request.x != nil || request.y != nil) {
            fail("`cu \(command)` takes either --element or --x/--y, not both")
        }
        if command == "click" {
            request.count = intOption(arguments, "count")
            request.button = arguments.options["button"]
        } else {
            guard let direction = arguments.options["direction"] else {
                fail("`cu scroll` needs --direction up, down, left or right")
            }
            request.direction = direction
            request.pages = doubleOption(arguments, "pages")
        }
    case "type":
        request.app = requireApp(arguments, command)
        let text = rest.joined(separator: " ")
        if text.isEmpty {
            fail("`cu type` needs the text to type")
        }
        request.text = text
    case "key":
        request.app = requireApp(arguments, command)
        if rest.isEmpty {
            fail("`cu key` needs at least one key combo, e.g. cmd+n")
        }
        request.combos = rest
    case "set-value":
        request.app = requireApp(arguments, command)
        guard let element = intOption(arguments, "element") else {
            fail("`cu set-value` needs --element N")
        }
        if rest.isEmpty {
            fail("`cu set-value` needs the value to set")
        }
        request.element = element
        request.value = rest.joined(separator: " ")
    case "menu":
        request.app = requireApp(arguments, command)
        if !rest.isEmpty {
            request.path = rest.joined(separator: " ")
        }
    default:
        fail("unknown command \"\(command)\"; run `cu help`")
    }
    return request
}

func agentAppPath() -> String? {
    if let override = ProcessInfo.processInfo.environment["RUIMTE_COMPUTER_USE_APP"] {
        return override
    }
    guard var url = Bundle.main.executableURL?.resolvingSymlinksInPath() else {
        return nil
    }
    while url.path != "/" {
        if url.pathExtension == "app" {
            return url.path
        }
        url = url.deletingLastPathComponent()
    }
    return nil
}

func launchAgent(_ home: Home) {
    guard let path = agentAppPath() else {
        fail("the agent is not running and this cu is not inside Ruimte Computer Use.app; set RUIMTE_COMPUTER_USE_APP to the app path")
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = ["-g", path, "--args", "--home", home.path]
    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        fail("could not start the agent with `open \(path)`: \(error)")
    }
    if process.terminationStatus != 0 {
        fail("`open \(path)` exited with status \(process.terminationStatus)")
    }
}

func connectToAgent(_ home: Home, launchIfNeeded: Bool) -> Int32? {
    let path = home.socketPath
    if let descriptor = UnixSocket.connect(to: path) {
        return descriptor
    }
    guard launchIfNeeded else {
        return nil
    }
    launchAgent(home)
    for _ in 0..<100 {
        usleep(100_000)
        if let descriptor = UnixSocket.connect(to: path) {
            return descriptor
        }
    }
    fail("started the agent but it did not open \(path) within 10 seconds; an agent already running for another home keeps this one from starting, `cu quit --home <that home>` stops it")
}

func resolveHome(_ arguments: Arguments) -> Home {
    let app = agentAppPath()
    let bundleIdentifier = app.flatMap { Bundle(path: $0)?.bundleIdentifier }
    return Home.resolve(
        explicit: arguments.options["home"],
        environment: ProcessInfo.processInfo.environment,
        development: Home.isDevelopment(bundleIdentifier: bundleIdentifier),
        userHome: NSHomeDirectory()
    )
}

func send(_ request: Request, home: Home) -> [String: Any] {
    var request = request
    guard let secret = LocalSecret.read(at: home.secretPath) else {
        fail("no local secret at \(home.secretPath); start the Ruimte daemon for this home first, or pass --home")
    }
    request.secret = secret
    guard let descriptor = connectToAgent(home, launchIfNeeded: request.command != "quit") else {
        return ["ok": true, "result": ["stopped": false, "message": "the agent was not running"]]
    }
    defer {
        close(descriptor)
    }
    guard let body = try? JSONEncoder().encode(request) else {
        fail("could not encode the request")
    }
    UnixSocket.setReadTimeout(descriptor, seconds: 120)
    guard UnixSocket.writeAll(descriptor, body) else {
        fail("could not send the request to the agent")
    }
    shutdown(descriptor, SHUT_WR)
    let reply = UnixSocket.readAll(descriptor)
    guard !reply.isEmpty else {
        fail("the agent closed the connection without an answer (it may have crashed or timed out)")
    }
    guard let object = try? JSONSerialization.jsonObject(with: reply) as? [String: Any] else {
        fail("the agent sent something that is not JSON")
    }
    return object
}

func printStateAsText(_ result: [String: Any]) {
    var lines: [String] = []
    if let app = result["app"] as? [String: Any] {
        lines.append("app: \(app["name"] ?? "?") (\(app["bundleId"] ?? "?"), pid \(app["pid"] ?? "?"))")
    }
    if let window = result["window"] as? [String: Any], let frame = window["frame"] as? [String: Any] {
        lines.append("window: \"\(window["title"] ?? "")\" at (\(frame["x"] ?? 0),\(frame["y"] ?? 0)) size \(frame["width"] ?? 0)x\(frame["height"] ?? 0) points")
        if let sheet = window["sheet"] {
            lines.append("sheet: \"\(sheet)\" (the key window; the tree and screenshot show it over its parent)")
        }
    }
    if let screenshot = result["screenshot"] as? [String: Any] {
        if let path = screenshot["path"] {
            let origin = screenshot["origin"] as? [String: Any] ?? [:]
            lines.append("screenshot: \(path) (\(screenshot["width"] ?? 0)x\(screenshot["height"] ?? 0) px, scale \(screenshot["scale"] ?? 0) px per point, origin \(origin["x"] ?? 0),\(origin["y"] ?? 0))")
        } else if let error = screenshot["error"] {
            lines.append("screenshot: none (\(error))")
        }
    }
    if let truncated = result["truncated"] {
        lines.append("truncated: \(truncated)")
    }
    if let note = result["note"] {
        lines.append("note: \(note)")
    }
    lines.append("")
    lines.append(contentsOf: result["tree"] as? [String] ?? [])
    print(lines.joined(separator: "\n"))
}

var tokens = Array(CommandLine.arguments.dropFirst())
guard let command = tokens.first, !["help", "--help", "-h"].contains(command) else {
    print(usage)
    exit(0)
}
tokens.removeFirst()
let arguments = parse(tokens)
if arguments.flags.contains("help") {
    print(usage)
    exit(0)
}

let reply = send(makeRequest(command, arguments), home: resolveHome(arguments))
guard reply["ok"] as? Bool == true else {
    fail(reply["error"] as? String ?? "the agent failed without a message")
}
let result = reply["result"] as? [String: Any] ?? [:]
if !arguments.flags.contains("text") {
    printJSON(result)
} else if command == "state" {
    printStateAsText(result)
} else if command == "menu", let lines = result["menu"] as? [String] {
    print(lines.joined(separator: "\n"))
} else {
    var summary = result
    summary["state"] = nil
    printCompactJSON(summary)
    if let state = result["state"] as? [String: Any] {
        print("")
        if let error = state["error"] {
            print("state: none (\(error))")
        } else {
            if let settled = result["settled"] as? Bool, !settled {
                print("note: the UI was still changing after 3 seconds")
            }
            printStateAsText(state)
        }
    }
}
