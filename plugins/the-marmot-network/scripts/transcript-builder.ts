/**
 * TranscriptBuilder — programmatic construction of Claude Code transcript records.
 *
 * Usage:
 *   const t = new TranscriptBuilder()
 *     .userMessage("Fix my Tanstack Start crash")
 *     .toolCall("Bash", "toolu-1", { command: "cat package.json" })
 *     .toolResult("toolu-1", false, '{"dependencies":{}}')
 *     .toolCall("Bash", "toolu-2", { command: "cat tsconfig.json" })
 *     .toolResult("toolu-2", true, "Error: file not found")
 *     .build();
 *
 *   const result = detect(t.records, t.byteSize);
 */

import type { TranscriptRecord } from "./detect-shareable.ts";

let globalCounter = 0;

function nextUuid(): string {
  globalCounter += 1;
  return `uuid-${String(globalCounter).padStart(4, "0")}`;
}

function nextToolId(): string {
  globalCounter += 1;
  return `toolu-${String(globalCounter).padStart(4, "0")}`;
}

export interface BuiltTranscript {
  records: TranscriptRecord[];
  byteSize: number;
  /** Serialized JSONL — useful for piping into the CLI entry point */
  toJsonl(): string;
}

export class TranscriptBuilder {
  private records: TranscriptRecord[] = [];
  private baseTime: Date;
  private elapsed = 0; // seconds

  constructor(baseTime?: Date) {
    this.baseTime = baseTime ?? new Date("2026-03-20T10:00:00.000Z");
  }

  private tick(seconds = 30): string {
    this.elapsed += seconds;
    return new Date(this.baseTime.getTime() + this.elapsed * 1000).toISOString();
  }

  /** External user message */
  userMessage(text: string): this {
    this.records.push({
      type: "user",
      userType: "external",
      timestamp: this.tick(5),
      message: { content: [{ type: "text", text }] },
    });
    return this;
  }

  /** Assistant text-only response (no tool calls) */
  assistantMessage(text: string): this {
    this.records.push({
      type: "assistant",
      timestamp: this.tick(),
      message: { content: [{ type: "text", text }] },
    });
    return this;
  }

  /** Assistant response containing one tool call. Returns the generated tool ID. */
  toolCall(toolName: string, toolId?: string, input?: unknown): this {
    const id = toolId ?? nextToolId();
    this.records.push({
      type: "assistant",
      timestamp: this.tick(),
      message: {
        content: [
          {
            type: "tool_use",
            id,
            name: toolName,
            input: input ?? {},
          },
        ],
      },
    });
    return this;
  }

  /** Tool result (success or error) */
  toolResult(toolUseId: string, isError: boolean, content: string): this {
    this.records.push({
      type: "tool_result",
      timestamp: this.tick(isError ? 2 : 5),
      toolUseResult: {
        tool_use_id: toolUseId,
        is_error: isError,
        content,
      },
    });
    return this;
  }

  // ── Compound helpers for common patterns ──

  /** Tool call + successful result in one shot */
  successfulTool(toolName: string, input: unknown, resultContent: string): this {
    const id = nextToolId();
    return this.toolCall(toolName, id, input).toolResult(id, false, resultContent);
  }

  /** Tool call + error result in one shot */
  failedTool(toolName: string, input: unknown, errorContent: string): this {
    const id = nextToolId();
    return this.toolCall(toolName, id, input).toolResult(id, true, errorContent);
  }

  /**
   * Retry pattern: same tool called N times with different inputs.
   * First (N - successAtEnd) calls fail, last one optionally succeeds.
   */
  retrySequence(
    toolName: string,
    attempts: { input: unknown; error: string }[],
    finalSuccess?: { input: unknown; result: string },
  ): this {
    for (const attempt of attempts) {
      this.failedTool(toolName, attempt.input, attempt.error);
    }
    if (finalSuccess) {
      this.successfulTool(toolName, finalSuccess.input, finalSuccess.result);
    }
    return this;
  }

  /** Pad the transcript with N filler tool calls to inflate byte size.
   *  Uses identical inputs to avoid triggering the retry pattern. */
  padWithFiller(count: number): this {
    for (let i = 0; i < count; i++) {
      this.successfulTool("Read", { filePath: "src/filler.ts" }, `// filler line ${i}\n`.repeat(20));
    }
    return this;
  }

  build(): BuiltTranscript {
    const records = [...this.records];
    const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
    const byteSize = new TextEncoder().encode(jsonl).byteLength;
    return {
      records,
      byteSize,
      toJsonl: () => jsonl,
    };
  }
}
