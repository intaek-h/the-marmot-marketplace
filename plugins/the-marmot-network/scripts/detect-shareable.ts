// ── Types ──────────────────────────────────────────────────────

export interface TranscriptContentItem {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface TranscriptRecord {
  type?: string;
  timestamp?: string;
  userType?: string;
  message?: {
    content?: TranscriptContentItem[];
  };
  toolUseResult?: {
    tool_use_id?: string;
    is_error?: boolean;
    content?: string;
  };
}

export interface DetectionOutput {
  shareable: boolean;
  score: number;
  reasons: string[];
  summary: string;
}

// ── Constants ──────────────────────────────────────────────────

export const EMPTY_RESULT: DetectionOutput = {
  shareable: false,
  score: 0,
  reasons: [],
  summary: "",
};

export const THRESHOLD = 3;

// ── Helpers ────────────────────────────────────────────────────

export function safeJsonParse(line: string): TranscriptRecord | null {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object") {
      return parsed as TranscriptRecord;
    }
  } catch {
    return null;
  }
  return null;
}

function inputSignature(input: unknown): string {
  try {
    return JSON.stringify(input) ?? "undefined";
  } catch {
    return String(input);
  }
}

// ── Core detection ─────────────────────────────────────────────

export function detect(records: TranscriptRecord[], inputBytes: number): DetectionOutput {
  if (records.length === 0) {
    return EMPTY_RESULT;
  }

  const reasons: string[] = [];
  let score = 0;

  const toolUseToName = new Map<string, string>();
  const toolInputs = new Map<string, Set<string>>();
  const toolCallCounts = new Map<string, number>();

  for (const record of records) {
    if (record.type !== "assistant") {
      continue;
    }

    const content = record.message?.content ?? [];
    for (const item of content) {
      if (item.type !== "tool_use") {
        continue;
      }

      const toolName = typeof item.name === "string" ? item.name : "";
      const toolId = typeof item.id === "string" ? item.id : "";
      if (!toolName) {
        continue;
      }

      if (toolId) {
        toolUseToName.set(toolId, toolName);
      }

      toolCallCounts.set(toolName, (toolCallCounts.get(toolName) ?? 0) + 1);

      const signatures = toolInputs.get(toolName) ?? new Set<string>();
      signatures.add(inputSignature(item.input));
      toolInputs.set(toolName, signatures);
    }
  }

  // Signal 1: Tool failures
  let failureCount = 0;
  for (const record of records) {
    if (record.type === "tool_result" && record.toolUseResult?.is_error === true) {
      failureCount += 1;
    }
  }
  const failureScore = Math.min(failureCount, 5);
  score += failureScore;
  if (failureScore > 0) {
    reasons.push(`${failureCount} tool errors observed (+${failureScore})`);
  }

  // Signal 2: Retry pattern
  let hasRetryPattern = false;
  for (const [toolName, count] of toolCallCounts.entries()) {
    const distinctInputs = toolInputs.get(toolName)?.size ?? 0;
    if (count >= 3 && distinctInputs >= 2) {
      hasRetryPattern = true;
      break;
    }
  }
  if (hasRetryPattern) {
    score += 2;
    reasons.push("Detected repeated tool retries with varied inputs (+2)");
  }

  // Signal 3: Error-to-success arc
  let hasErrorSuccessArc = false;
  const seenErrorByTool = new Map<string, boolean>();
  for (const record of records) {
    if (record.type !== "tool_result" || !record.toolUseResult?.tool_use_id) {
      continue;
    }

    const toolName = toolUseToName.get(record.toolUseResult.tool_use_id);
    if (!toolName) {
      continue;
    }

    if (record.toolUseResult.is_error === true) {
      seenErrorByTool.set(toolName, true);
      continue;
    }

    if (record.toolUseResult.is_error === false && seenErrorByTool.get(toolName) === true) {
      hasErrorSuccessArc = true;
      break;
    }
  }
  if (hasErrorSuccessArc) {
    score += 2;
    reasons.push("Detected error-to-success recovery arc (+2)");
  }

  // Signal 4: Transcript size multiplier
  const inputKB = Math.round(inputBytes / 1024);
  if (score > 0 && inputKB >= 100) {
    score += 1;
    reasons.push(`Transcript size ${inputKB}KB (multiplier +1)`);
  }

  // Extract summary from first external user message
  let summary = "";
  for (const record of records) {
    if (record.type === "user" && record.userType === "external") {
      const firstText = record.message?.content?.[0]?.text;
      if (typeof firstText === "string") {
        summary = firstText;
      }
      break;
    }
  }

  return {
    shareable: score >= THRESHOLD,
    score,
    reasons,
    summary,
  };
}

// ── CLI entry point ────────────────────────────────────────────

import { fileURLToPath } from "node:url";

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk as string);
  }
  return chunks.join("");
}

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      console.log(JSON.stringify(EMPTY_RESULT));
      return;
    }

    const records: TranscriptRecord[] = [];
    for (const line of lines) {
      const parsed = safeJsonParse(line);
      if (parsed) {
        records.push(parsed);
      }
    }

    if (records.length === 0) {
      console.log(JSON.stringify(EMPTY_RESULT));
      return;
    }

    console.log(JSON.stringify(detect(records, Buffer.byteLength(input, "utf-8"))));
  } catch (err) {
    console.error("[heymarmot] detect-shareable error:", err);
    console.log(JSON.stringify(EMPTY_RESULT));
  }
}

// Only run main when executed directly (not imported)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
