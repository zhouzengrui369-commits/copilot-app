import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const sourcePath = path.join(root, "apps", "server", "src", "index.ts");
const source = fs.readFileSync(sourcePath, "utf8");

const restartCall = /runGatewayLifecycleAction\(\s*["']restart["']/;
const approvalGate = /knowledgeNoteGatewayRestartApproved\(\)/;
const mainApprovalMessage = /gateway_restart_main_approval_required/;

if (restartCall.test(source) && !approvalGate.test(source)) {
  throw new Error("Knowledge-note Worker ops recovery can call Gateway restart without an explicit approval gate.");
}

if (!mainApprovalMessage.test(source)) {
  throw new Error("Knowledge-note Worker ops recovery must surface gateway_restart_main_approval_required when restart is blocked.");
}

console.log(JSON.stringify({
  ok: true,
  checked: "knowledge_note_ops_gateway_restart_gate",
  sourcePath,
}));
