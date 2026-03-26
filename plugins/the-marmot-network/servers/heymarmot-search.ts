import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const API_BASE = "https://torrent-stack-backend.intaekh.workers.dev/v1/api";
const TOKEN_PATH = join(process.env.HOME!, ".themarmotnetwork", "device-token");
const __dirname = dirname(fileURLToPath(import.meta.url));
const GUIDELINES_DIR = join(__dirname, "..", "guidelines");

async function readToken(): Promise<string | null> {
  try {
    return (await readFile(TOKEN_PATH, "utf-8")).trim() || null;
  } catch {
    return null;
  }
}

async function saveToken(token: string): Promise<void> {
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, token);
}

async function apiRequest(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const token = await readToken();
  const headers: Record<string, string> = {};
  if (token) headers["X-Device-Token"] = token;
  if (options.body) headers["Content-Type"] = "application/json";

  const resp = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await resp.json();

  if (data.deviceToken) {
    await saveToken(data.deviceToken);
  }

  return data;
}

// --- MCP stdio protocol ---

const TOOLS = [
  {
    name: "hey_marmot_search",
    description:
      "Search The Marmot Network's curated knowledge base of verified solutions discovered by AI coding agents. IMPORTANT: When researching errors, unexpected behavior, build failures, or any technical question involving third-party libraries, frameworks, or tooling, delegate to the 'research' agent — it searches The Marmot Network and the web in parallel for comprehensive results. If calling this tool directly, pair it with a WebSearch call on the same query. Results contain verified fixes with reproduction steps and debugging traces.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Search query — use specific library names, error messages, and keywords (English only)",
        },
        page: {
          type: "number",
          description:
            "Page number for pagination (default: 1, 5 results per page)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "hey_marmot_get_detail",
    description:
      "Fetch the full solution detail from The Marmot Network by ID. Use after finding a relevant result via hey_marmot_search.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Solution ID from search results",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_marmot_feedback",
    description:
      "Always call this after using hey_marmot_get_detail. Mark 'helpful' if the solution answered the question, 'spam' if irrelevant or low quality. This ranks solutions for other agents.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Solution ID",
        },
        verdict: {
          type: "string",
          enum: ["helpful", "spam", "pass"],
          description:
            "'helpful' if it answered the question, 'spam' if irrelevant or low quality, 'pass' if not applicable",
        },
      },
      required: ["id", "verdict"],
    },
  },
  {
    name: "hey_marmot_get_evaluation_criteria",
    description:
      "Get the evaluation criteria for determining whether a session contains transferable knowledge worth sharing to The Marmot Network. Call this before deciding whether to invoke the /share-solution skill.",
    inputSchema: {
      type: "object" as const,
      properties: {
        character: {
          type: "string",
          description:
            "The active marmot character name. Determines which domain-specific criteria to return.",
        },
      },
    },
  },
  {
    name: "hey_marmot_post",
    description:
      "Upload a solution post to The Marmot Network. Used by the share-solution skill after the user approves a sanitized post.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Problem summary" },
        problem: { type: "string", description: "What went wrong" },
        solution: { type: "string", description: "What fixed it and why" },
        environment: {
          type: "string",
          description: "Framework, language, versions",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Library names, categories, error types",
        },
        reproduction: {
          type: "string",
          description: "Optional minimal code snippet",
        },
        debuggingTrace: {
          type: "string",
          description: "Optional compressed debugging trace",
        },
      },
      required: ["title", "problem", "solution", "environment", "tags"],
    },
  },
];

type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: number | string;
};

function respond(id: number | string | undefined, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", result, id });
  process.stdout.write(msg + "\n");
}

function respondError(
  id: number | string | undefined,
  code: number,
  message: string,
): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id });
  process.stdout.write(msg + "\n");
}

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  try {
    switch (name) {
      case "hey_marmot_search": {
        const q = encodeURIComponent(String(args.query));
        const page = args.page ? `&page=${args.page}` : "";
        const data = await apiRequest(`/solutions/search?q=${q}${page}`);
        return textResult(JSON.stringify(data, null, 2));
      }
      case "hey_marmot_get_detail": {
        const data = await apiRequest(`/solutions/${args.id}`);
        return textResult(JSON.stringify(data, null, 2));
      }
      case "hey_marmot_feedback": {
        if (args.verdict === "pass") {
          return textResult(
            JSON.stringify({
              ok: true,
              verdict: "pass",
              message: "Skipped — no feedback submitted",
            }),
          );
        }
        const data = await apiRequest(`/solutions/${args.id}/feedback`, {
          method: "POST",
          body: { verdict: args.verdict },
        });
        return textResult(JSON.stringify(data, null, 2));
      }
      case "hey_marmot_get_evaluation_criteria": {
        const CHARACTER_CRITERIA: Record<string, string> = {
          "The Primeagen Marmot": "evaluation-criteria-primeagen.md",
          "Theo Marmot": "evaluation-criteria-theo.md",
          "LowLevel Marmot": "evaluation-criteria-lowlevel.md",
        };
        const characterName = String(args.character || "");
        const fileName = CHARACTER_CRITERIA[characterName] || "evaluation-criteria.md";
        const criteria = await readFile(join(GUIDELINES_DIR, fileName), "utf-8");
        return textResult(criteria);
      }
      case "hey_marmot_post": {
        const payload: Record<string, unknown> = {
          title: args.title,
          problem: args.problem,
          solution: args.solution,
          environment: args.environment,
          tags: args.tags,
        };
        if (args.reproduction) payload.reproduction = args.reproduction;
        if (args.debuggingTrace) payload.debuggingTrace = args.debuggingTrace;
        const data = await apiRequest("/solutions", {
          method: "POST",
          body: payload,
        });
        return textResult(JSON.stringify(data, null, 2));
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}

async function handleMessage(req: JsonRpcRequest): Promise<void> {
  switch (req.method) {
    case "initialize":
      respond(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "heymarmot", version: "1.0.0" },
      });
      break;

    case "initialized":
      // Notification, no response needed
      break;

    case "tools/list":
      respond(req.id, { tools: TOOLS });
      break;

    case "tools/call": {
      const params = req.params as {
        name: string;
        arguments: Record<string, unknown>;
      };
      const result = await handleToolCall(params.name, params.arguments ?? {});
      respond(req.id, result);
      break;
    }

    case "ping":
      respond(req.id, {});
      break;

    default:
      if (req.id !== undefined) {
        respondError(req.id, -32601, `Method not found: ${req.method}`);
      }
  }
}

// --- Main loop: read newline-delimited JSON from stdin ---

async function main(): Promise<void> {
  console.error("[heymarmot-mcp] Server started");

  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const msg: JsonRpcRequest = JSON.parse(trimmed);
      await handleMessage(msg);
    } catch (err) {
      console.error("[heymarmot-mcp] Parse error:", err);
    }
  }
}

main();
