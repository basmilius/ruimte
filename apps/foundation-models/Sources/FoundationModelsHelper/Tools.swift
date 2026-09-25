import FoundationModels

struct ListFiles: Tool {
    let name = "ListFiles"
    let description = "List names in a project directory. Always use this tool to discover files. Approval is required."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Project-relative directory path. Use . for the project root.") var path: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "list_files", path: arguments.path))
    }
}

struct ReadFile: Tool {
    let name = "Read"
    let description = "Read a project text file, up to 100 lines. If nextOffset is not null, continue with Read at that offset. Approval is required."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Project-relative file path") var path: String
        @Guide(description: "Zero-based first line", .range(0...100_000)) var offset: Int
        @Guide(description: "Lines to read, default 100; use smaller values only for a requested excerpt") var limit: Int?
    }

    func call(arguments: Arguments) async throws -> String {
        let output = try await bridge.call(Frame(type: "tool.call", name: "read_file", path: arguments.path, offset: arguments.offset, limit: arguments.limit))
        return FileReadOutput.modelText(output)
    }
}


struct SearchFiles: Tool {
    let name = "Grep"
    let description = "Literal text search inside project files."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Directory, . for root") var path: String
        @Guide(description: "Literal search text") var query: String
        @Guide(description: "Optional filename glob") var glob: String?
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "search_files", path: arguments.path, query: arguments.query, glob: arguments.glob))
    }
}

struct EditFile: Tool {
    let name = "Edit"
    let description = "Replace one unique exact match in a project file. Read first, then copy a short passage exactly. A rejected match changes nothing; read again and correct it."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Project-relative path") var path: String
        @Guide(description: "Short unique passage copied exactly from Read, including spaces and heading markers. Use real line breaks, not backslash-n.") var oldText: String
        @Guide(description: "Replacement text with real line breaks") var newText: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "edit_file", path: arguments.path, oldText: arguments.oldText, newText: arguments.newText))
    }
}

struct WriteFile: Tool {
    let name = "Write"
    let description = "Create a new project file. Cannot overwrite existing files."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Project-relative path") var path: String
        @Guide(description: "Complete new file text") var content: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "write_file", path: arguments.path, content: arguments.content))
    }
}

struct RunCommand: Tool {
    let name = "Bash"
    let description = "Run an approved shell command in the project directory, limited to 30 seconds."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Shell command") var command: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "run_command", command: arguments.command))
    }
}

struct WebSearch: Tool {
    let name = "WebSearch"
    let description = "Search the public web using the configured search service."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Search query") var query: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "web_search", query: arguments.query))
    }
}

struct FetchPage: Tool {
    let name = "WebFetch"
    let description = "Fetch a public HTTP(S) page as text."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Public page URL") var url: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "fetch_page", url: arguments.url))
    }
}

struct MCPListTools: Tool {
    let name = "MCPListTools"
    let description = "List MCP servers; with server list tools; with server and tool inspect its input schema."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Optional configured server name") var server: String?
        @Guide(description: "Optional tool whose input schema to inspect") var tool: String?
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "mcp_list_tools", server: arguments.server, tool: arguments.tool))
    }
}

struct MCPCall: Tool {
    let name = "MCPCall"
    let description = "Call a configured MCP server tool, after listing its input schema."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Configured server name") var server: String
        @Guide(description: "Tool name") var tool: String
        @Guide(description: "JSON object encoded as a string") var arguments: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "mcp_call", server: arguments.server, tool: arguments.tool, arguments: arguments.arguments))
    }
}

struct AskUser: Tool {
    let name = "AskUserQuestion"
    let description = "Ask the person for a missing decision needed to finish their task, or when explicitly asked to ask them. Opens a question card and waits. Do not use this to answer questions about information already in the conversation or files."
    let bridge: ToolBridge

    @Generable
    struct Arguments {
        @Guide(description: "Question") var question: String
        @Guide(description: "Optional answer choices, at most 6") var options: [String]?
    }

    func call(arguments: Arguments) async throws -> String {
        try await bridge.call(Frame(type: "tool.call", name: "ask_user", question: arguments.question, options: arguments.options))
    }
}
