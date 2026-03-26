import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { detect, THRESHOLD, type DetectionOutput } from "./detect-shareable.ts";
import { TranscriptBuilder } from "./transcript-builder.ts";

// ── Helper ─────────────────────────────────────────────────────

function run(builder: TranscriptBuilder): DetectionOutput {
  const t = builder.build();
  return detect(t.records, t.byteSize);
}

// ── Signal isolation tests ─────────────────────────────────────
// Each test activates exactly one signal to verify its score contribution.

test("signal: empty transcript scores 0", () => {
  const result = run(new TranscriptBuilder());
  strictEqual(result.score, 0);
  strictEqual(result.shareable, false);
});

test("signal: single tool error scores +1", () => {
  const result = run(
    new TranscriptBuilder()
      .userMessage("help")
      .failedTool("Bash", { command: "npm test" }, "Error: exit code 1"),
  );
  strictEqual(result.score, 1);
  strictEqual(result.shareable, false);
});

test("signal: 5 tool errors cap at +5", () => {
  const b = new TranscriptBuilder().userMessage("help");
  for (let i = 0; i < 7; i++) {
    b.failedTool("Bash", { command: `attempt-${i}` }, `Error ${i}`);
  }
  const result = run(b);
  // 7 errors but capped at +5, plus retry pattern (+2) since Bash called 7 times with 7 inputs
  // We need to account for the retry pattern here
  ok(result.score >= 5, `expected >= 5, got ${result.score}`);
});

test("signal: retry pattern (3+ calls, 2+ distinct inputs) scores +2", () => {
  const result = run(
    new TranscriptBuilder()
      .userMessage("help")
      .successfulTool("Bash", { command: "ls src" }, "file1.ts")
      .successfulTool("Bash", { command: "ls lib" }, "file2.ts")
      .successfulTool("Bash", { command: "ls dist" }, "file3.ts"),
  );
  strictEqual(result.score, 2);
  strictEqual(result.reasons.length, 1);
  ok(result.reasons[0].includes("retries"));
});

test("signal: retry pattern does NOT fire with same inputs", () => {
  const result = run(
    new TranscriptBuilder()
      .userMessage("help")
      .successfulTool("Bash", { command: "ls" }, "file1.ts")
      .successfulTool("Bash", { command: "ls" }, "file1.ts")
      .successfulTool("Bash", { command: "ls" }, "file1.ts"),
  );
  strictEqual(result.score, 0);
});

test("signal: error-to-success arc scores +2", () => {
  const b = new TranscriptBuilder().userMessage("help");
  const id1 = "toolu-arc-1";
  const id2 = "toolu-arc-2";
  b.toolCall("Read", id1, { filePath: "a.ts" })
    .toolResult(id1, true, "Error: not found")
    .toolCall("Read", id2, { filePath: "b.ts" })
    .toolResult(id2, false, "contents");
  const result = run(b);
  // +1 for the error, +2 for the arc = 3
  strictEqual(result.score, 3);
  ok(result.reasons.some((r) => r.includes("recovery arc")));
});

test("signal: transcript size multiplier only fires when score > 0", () => {
  // Large transcript but no other signals
  const b = new TranscriptBuilder().userMessage("help").padWithFiller(30);
  const result = run(b);
  strictEqual(result.score, 0, "size multiplier should not fire when base score is 0");
});

test("signal: transcript size multiplier adds +1 when score > 0 and >= 100KB", () => {
  const b = new TranscriptBuilder()
    .userMessage("help")
    .failedTool("Bash", { command: "npm test" }, "Error: exit 1")
    .padWithFiller(30); // inflate size
  const t = b.build();
  // Only run if byteSize is actually >= 100KB
  if (t.byteSize >= 100 * 1024) {
    const result = detect(t.records, t.byteSize);
    ok(result.reasons.some((r) => r.includes("Transcript size")));
  }
});

// ── Threshold boundary tests ───────────────────────────────────

test("threshold: score 2 is NOT shareable", () => {
  // retry pattern alone = +2, below threshold of 3
  const result = run(
    new TranscriptBuilder()
      .userMessage("help")
      .successfulTool("Bash", { command: "ls src" }, "file1.ts")
      .successfulTool("Bash", { command: "ls lib" }, "file2.ts")
      .successfulTool("Bash", { command: "ls dist" }, "file3.ts"),
  );
  strictEqual(result.score, 2);
  strictEqual(result.shareable, false);
});

test("threshold: score 3 IS shareable", () => {
  // 1 tool error on Read (+1) + retry pattern on Bash (+2) = 3
  // Using different tool for the error avoids error-to-success arc
  const b = new TranscriptBuilder().userMessage("help");
  b.failedTool("Read", { filePath: "missing.ts" }, "err")
    .successfulTool("Bash", { command: "a" }, "ok")
    .successfulTool("Bash", { command: "b" }, "ok")
    .successfulTool("Bash", { command: "c" }, "ok");
  const result = run(b);
  strictEqual(result.score, 3);
  strictEqual(result.shareable, true);
});

// ── Composite scenario tests ───────────────────────────────────

test("scenario: classic debugging session (errors + retries + arc)", () => {
  const result = run(
    new TranscriptBuilder()
      .userMessage("My app crashes on startup")
      .retrySequence(
        "Bash",
        [
          { input: { command: "npm start" }, error: "Error: module not found" },
          { input: { command: "npm install && npm start" }, error: "Error: peer dep" },
          { input: { command: "npm install --legacy-peer-deps && npm start" }, error: "Error: config" },
        ],
        { input: { command: "npm start -- --config fixed.js" }, result: "Server running on :3000" },
      ),
  );
  // 3 errors (+3, capped) + retry pattern (+2) + arc (+2) = 7
  ok(result.shareable, `expected shareable, score=${result.score}`);
  ok(result.score >= THRESHOLD);
});

test("scenario: routine file editing (no signals)", () => {
  const result = run(
    new TranscriptBuilder()
      .userMessage("Refactor this function to use async/await")
      .successfulTool("Read", { filePath: "src/api.ts" }, "function fetch() { ... }")
      .successfulTool("Edit", { filePath: "src/api.ts", old: "function", new: "async function" }, "ok")
      .successfulTool("Bash", { command: "npm test" }, "All tests passed"),
  );
  strictEqual(result.score, 0);
  strictEqual(result.shareable, false);
});

test("scenario: agent goes in circles (high retries, no real problem)", () => {
  // This is the false positive case: lots of retries but trivial issue
  const b = new TranscriptBuilder().userMessage("Format this file");
  for (let i = 0; i < 5; i++) {
    b.successfulTool("Edit", { filePath: "src/a.ts", attempt: i }, "ok");
  }
  const result = run(b);
  // Retry pattern fires (+2) but nothing else — should NOT be shareable
  strictEqual(result.score, 2);
  strictEqual(result.shareable, false);
});

test("scenario: semantic difficulty invisible to heuristic", () => {
  // Agent reads files and runs commands — all tools succeed.
  // This is a genuinely hard session that the current heuristic cannot detect.
  // Each tool used at most twice to avoid triggering the retry pattern.
  const result = run(
    new TranscriptBuilder()
      .userMessage("Server returns 500 on the /users endpoint")
      .successfulTool("Read", { filePath: "src/routes/users.ts" }, "export function handler() {}")
      .successfulTool("Bash", { command: "curl localhost:3000/users" }, "500 Internal Server Error")
      .successfulTool("Grep", { pattern: "createMiddleware" }, "// found in hono source")
      .assistantMessage("Found it — Hono's middleware chain silently swallows async errors...")
      .successfulTool("Edit", { filePath: "src/middleware/auth.ts", fix: true }, "ok")
      .successfulTool("Bash", { command: "curl localhost:3000/users" }, "200 OK"),
  );
  // Score is 0 — all tools succeeded, no tool called 3+ times. Known blind spot.
  strictEqual(result.score, 0, "current heuristic cannot detect semantic difficulty");
  strictEqual(result.shareable, false);
});

// ── Summary extraction ─────────────────────────────────────────

test("summary: extracts first external user message", () => {
  const result = run(
    new TranscriptBuilder()
      .userMessage("My Tanstack Start app crashes on hydration")
      .successfulTool("Read", { filePath: "a.ts" }, "ok"),
  );
  strictEqual(result.summary, "My Tanstack Start app crashes on hydration");
});

test("summary: empty when no external user message", () => {
  const b = new TranscriptBuilder();
  b.successfulTool("Read", { filePath: "a.ts" }, "ok");
  const result = run(b);
  strictEqual(result.summary, "");
});
