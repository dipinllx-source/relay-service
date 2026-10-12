// stdio JSON-RPC proxy between Codex Desktop and `codex app-server`.
// Rewrites only the response to `getAuthStatus` requests made with includeToken=false:
// result.authMethod "apikey" -> "personalAccessToken". Everything else passes through byte-for-byte.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [real, ...args] = process.argv.slice(2);
const LOG = join(dirname(fileURLToPath(import.meta.url)), "shim.log");
const FROM = "apikey";
const TO = "personalAccessToken";

function log(msg) {
  try { appendFileSync(LOG, `${new Date().toISOString()} pid=${process.pid} ${msg}\n`); } catch {}
}

const child = spawn(real, args, { stdio: ["pipe", "pipe", "inherit"], env: process.env });
const pending = new Set(); // JSON-encoded ids of getAuthStatus requests to rewrite

// Splits a byte stream into newline-terminated lines and calls onLine(buf) for each (without "\n").
function lineSplitter(onLine) {
  let carry = null;
  return (chunk) => {
    let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0, nl;
    while ((nl = buf.indexOf(0x0a, start)) !== -1) {
      onLine(buf.subarray(start, nl));
      start = nl + 1;
    }
    carry = start < buf.length ? Buffer.from(buf.subarray(start)) : null;
  };
}

const NL = Buffer.from("\n");

// client -> server: note getAuthStatus ids, forward unchanged.
process.stdin.on("data", lineSplitter((line) => {
  if (line.includes("getAuthStatus")) {
    try {
      const msg = JSON.parse(line);
      if (msg?.method === "getAuthStatus" && msg.id != null && msg.params?.includeToken !== true) {
        pending.add(JSON.stringify(msg.id));
      }
    } catch {}
  }
  if (!child.stdin.write(Buffer.concat([line, NL]))) {
    process.stdin.pause();
    child.stdin.once("drain", () => process.stdin.resume());
  }
}));
process.stdin.on("end", () => child.stdin.end());
child.stdin.on("error", () => {});

// server -> client: rewrite matching responses, forward the rest unchanged.
child.stdout.on("data", lineSplitter((line) => {
  let out = line;
  if (pending.size > 0 && line.includes("authMethod")) {
    try {
      const msg = JSON.parse(line);
      const key = msg?.id != null ? JSON.stringify(msg.id) : null;
      if (key && pending.has(key)) {
        pending.delete(key);
        if (msg.result && msg.result.authMethod === FROM) {
          msg.result.authMethod = TO;
          out = Buffer.from(JSON.stringify(msg));
          log(`rewrote getAuthStatus id=${key} ${FROM}->${TO}`);
        }
      }
    } catch {}
  }
  if (!process.stdout.write(Buffer.concat([out, NL]))) {
    child.stdout.pause();
    process.stdout.once("drain", () => child.stdout.resume());
  }
}));
child.stdout.on("end", () => process.stdout.end());
process.stdout.on("error", () => {});

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => { try { child.kill(sig); } catch {} });
}
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 0);
  // Exit once stdout has been flushed; force exit shortly after in case the client never closes.
  process.stdout.end(() => process.exit());
  setTimeout(() => process.exit(), 2000).unref();
});
child.on("error", (e) => { log(`spawn error: ${e.message}`); process.exit(127); });
log(`started real=${real} args=${JSON.stringify(args)}`);
