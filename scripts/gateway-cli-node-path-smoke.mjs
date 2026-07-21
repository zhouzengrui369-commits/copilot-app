const originalPath = process.env.PATH || "";
process.env.PATH = "/usr/bin:/bin";
process.env.OPENCLAW_GATEWAY_CLI = process.env.OPENCLAW_GATEWAY_CLI || `${process.env.HOME}/.npm-global/bin/openclaw-cn`;

const { gatewayControl } = await import("../apps/server/dist/connectors/gateway.js");

const result = await gatewayControl("status", { timeoutMs: 3_000, serializeCli: false });
const text = [
  result.error || "",
  result.stdout || "",
  result.stderr || "",
].join("\n");

if (/env:\s*node|No such file or directory/i.test(text)) {
  console.error("gateway-cli-node-path-smoke failed: Gateway CLI could not find node under a launchd-style PATH.");
  console.error(text.slice(0, 1200));
  process.env.PATH = originalPath;
  process.exit(1);
}

process.env.PATH = originalPath;
console.log(JSON.stringify({
  ok: true,
  status: result.status,
  error: result.error || "",
  checked: "gateway_cli_child_path_contains_node_runtime",
}, null, 2));
