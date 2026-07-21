import assert from "node:assert/strict";
import path from "node:path";
import {
  WORKBENCH_ENVIRONMENTS,
  assertWritableSmokeTarget,
  buildServerEnv,
  requireAllowedOperation,
  resolveRuntimeRoot,
} from "./env-config.mjs";

const fakeHome = "/Users/openclaw-test";
const fakeRepo = "/repo/openclaw/copilot";
const runtimeRoot = path.join(fakeRepo, "data", "env");

assert.equal(resolveRuntimeRoot({ HOME: fakeHome }, { repoRoot: fakeRepo }), runtimeRoot);
assert.deepEqual(Object.keys(WORKBENCH_ENVIRONMENTS), ["dev", "staging", "prod"]);

const devEnv = buildServerEnv("dev", { HOME: fakeHome, PATH: "/bin" }, { repoRoot: fakeRepo });
assert.equal(devEnv.OPENCLAW_WORKBENCH_ENV, "dev");
assert.equal(devEnv.OPENCLAW_WORKBENCH_PORT, "38889");
assert.equal(devEnv.OPENCLAW_DATA_DIR, path.join(runtimeRoot, "dev", "data"));
assert.equal(devEnv.OPENCLAW_WORKSPACE, path.join(runtimeRoot, "dev", "workspace"));
assert.equal(devEnv.OPENCLAW_WORKBENCH_PASSWORD, "openclaw2026");
assert.equal(devEnv.OPENCLAW_WORKBENCH_RESET_PASSWORD, "1");

const stagingEnv = buildServerEnv("staging", { HOME: fakeHome, PATH: "/bin" }, { repoRoot: fakeRepo });
assert.equal(stagingEnv.OPENCLAW_WORKBENCH_ENV, "staging");
assert.equal(stagingEnv.OPENCLAW_WORKBENCH_PORT, "38890");
assert.equal(stagingEnv.OPENCLAW_DATA_DIR, path.join(runtimeRoot, "staging", "data"));
assert.equal(stagingEnv.OPENCLAW_WORKSPACE, path.join(runtimeRoot, "staging", "workspace"));
assert.equal(stagingEnv.OPENCLAW_WORKBENCH_PASSWORD, "openclaw2026");
assert.equal(stagingEnv.OPENCLAW_WORKBENCH_RESET_PASSWORD, "1");

const prodEnv = buildServerEnv(
  "prod",
  { HOME: fakeHome, PATH: "/bin", OPENCLAW_WORKBENCH_PASSWORD: "prod-secret" },
  { repoRoot: fakeRepo },
);
assert.equal(prodEnv.OPENCLAW_WORKBENCH_ENV, "prod");
assert.equal(prodEnv.OPENCLAW_WORKBENCH_PORT, "38888");
assert.equal(prodEnv.OPENCLAW_DATA_DIR, path.join(fakeRepo, "data"));
assert.equal(prodEnv.OPENCLAW_WORKSPACE, fakeRepo);
assert.equal(prodEnv.OPENCLAW_WORKBENCH_PASSWORD, "prod-secret");
assert.notEqual(devEnv.OPENCLAW_DATA_DIR, prodEnv.OPENCLAW_DATA_DIR);
assert.notEqual(stagingEnv.OPENCLAW_DATA_DIR, prodEnv.OPENCLAW_DATA_DIR);

assert.throws(
  () => requireAllowedOperation("env:prod", "prod", {}),
  /requires OPENCLAW_ALLOW_PROD_OPS=YES-I-KNOW/,
);
assert.doesNotThrow(() => requireAllowedOperation("env:prod", "prod", { OPENCLAW_ALLOW_PROD_OPS: "YES-I-KNOW" }));

assert.throws(
  () => assertWritableSmokeTarget({ baseUrl: "http://127.0.0.1:38888", env: "prod", allowProdWrite: "" }),
  /refuses to run writable smoke against prod/,
);
assert.doesNotThrow(() => assertWritableSmokeTarget({ baseUrl: "http://127.0.0.1:38890", env: "staging" }));
assert.doesNotThrow(() => assertWritableSmokeTarget({
  baseUrl: "http://127.0.0.1:38888",
  env: "prod",
  allowProdWrite: "YES-I-KNOW",
}));

console.log("env isolation contract ok");
