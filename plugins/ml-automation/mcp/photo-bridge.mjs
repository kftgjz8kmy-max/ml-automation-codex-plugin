import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import readline from "node:readline";

const SERVER_NAME = "ml-automation-local-photos";
const SERVER_VERSION = "1.0.0";
const TOOL_NAME = "upload_listing_photos";
const UPLOAD_URL = "https://ml-automation-iota.vercel.app/api/mcp/photo-upload";
const MAX_FILES = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const SUPPORTED = new Map([[".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"]]);

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function sendResult(id, result) { send({ jsonrpc: "2.0", id, result }); }
function sendError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function text(value) { return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }; }

function nonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function isFile(path) { try { return statSync(path).isFile(); } catch { return false; } }
function mimeFor(path) { return SUPPORTED.get(extname(path).toLowerCase()); }
function isImage(path) { return Boolean(mimeFor(path)); }
function hasExpectedMagicBytes(bytes, mime) {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function walk(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(path));
    else if (entry.isFile() && isImage(path)) output.push(path);
  }
  return output;
}

function collectFiles(input, temporaryDirectories) {
  const selections = [input.zip_path, input.folder_path, input.file_paths].filter(Boolean);
  if (selections.length !== 1) throw new Error("Provide exactly one of zip_path, folder_path, or file_paths.");
  if (Array.isArray(input.file_paths)) return input.file_paths.map((path) => resolve(nonEmptyString(path, "file_paths[]"))).filter(isFile).filter(isImage).sort();
  if (input.folder_path) {
    const folder = resolve(nonEmptyString(input.folder_path, "folder_path"));
    try { if (!statSync(folder).isDirectory()) throw new Error(); } catch { throw new Error("folder_path must point to an existing folder."); }
    return walk(folder).sort();
  }
  const zip = resolve(nonEmptyString(input.zip_path, "zip_path"));
  if (!isFile(zip) || extname(zip).toLowerCase() !== ".zip") throw new Error("zip_path must point to an existing ZIP file.");
  const destination = mkdtempSync(join(tmpdir(), "ml-photos-"));
  temporaryDirectories.push(destination);
  execFileSync("/usr/bin/unzip", ["-qq", zip, "-d", destination], { stdio: "ignore", timeout: 30_000 });
  return walk(destination).sort();
}

async function uploadListingPhotos(args) {
  const uploadToken = nonEmptyString(args?.upload_token, "upload_token");
  const temporaryDirectories = [];
  try {
    const files = collectFiles(args ?? {}, temporaryDirectories);
    if (!files.length) throw new Error("No JPG, JPEG, or PNG files were found in the selected input.");
    if (files.length > MAX_FILES) throw new Error(`A maximum of ${MAX_FILES} images can be uploaded at once.`);
    const pictures = [];
    for (const path of files) {
      const bytes = readFileSync(path);
      const mime = mimeFor(path);
      if (!mime || bytes.byteLength > MAX_BYTES || !hasExpectedMagicBytes(bytes, mime)) throw new Error(`${basename(path)} is not a valid JPG, JPEG, or PNG image up to 10 MB.`);
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: mime }), basename(path));
      const response = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${uploadToken}`, Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.picture?.id !== "string") throw new Error(`The server could not upload ${basename(path)}.`);
      pictures.push({ id: payload.picture.id });
    }
    return text({ pictures, count: pictures.length, message: "Use pictures in prepare_listing and draft_create_listing. The upload grant was not stored." });
  } finally {
    for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  }
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    sendResult(id, { protocolVersion: params?.protocolVersion ?? "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }, instructions: "Use this tool only after ml-automation creates a short-lived upload grant. Never display or store that grant." });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "ping") { sendResult(id, {}); return; }
  if (method === "tools/list") {
    sendResult(id, { tools: [{
      name: TOOL_NAME,
      title: "Upload listing photos",
      description: "Upload JPG, JPEG, or PNG photos from one user-selected ZIP, folder, or explicit file list. This local tool only sends image bytes to ML Automation's fixed upload endpoint. It never receives or stores Mercado Libre credentials.",
      inputSchema: {
        type: "object",
        properties: {
          upload_token: { type: "string", minLength: 20, description: "Short-lived grant returned by start_listing_photo_upload. Never display it." },
          zip_path: { type: "string", description: "Absolute path to one user-provided ZIP." },
          folder_path: { type: "string", description: "Absolute path to one user-provided photo folder." },
          file_paths: { type: "array", minItems: 1, maxItems: MAX_FILES, items: { type: "string" }, description: "Explicit user-provided JPG/JPEG/PNG paths." }
        },
        required: ["upload_token"],
        additionalProperties: false,
        oneOf: [{ required: ["zip_path"] }, { required: ["folder_path"] }, { required: ["file_paths"] }]
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    }] });
    return;
  }
  if (method === "tools/call") {
    try {
      if (params?.name !== TOOL_NAME) throw new Error(`Unknown tool: ${params?.name ?? ""}`);
      sendResult(id, await uploadListingPhotos(params.arguments));
    } catch (error) { sendError(id, -32602, error instanceof Error ? error.message : "Photo upload failed."); }
    return;
  }
  if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try { void handleRequest(JSON.parse(line)); } catch { /* Ignore malformed JSON-RPC input. */ }
});
