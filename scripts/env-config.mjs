import path from "node:path";

export const WORKBENCH_ENVIRONMENTS = {
  dev: {
    port: 38889,
    password: "openclaw2026",
    dataMode: "isolated",
    workspaceMode: "isolated",
  },
  staging: {
    port: 38890,
    password: "openclaw2026",
    dataMode: "isolated",
    workspaceMode: "isolated",
  },
  prod: {
    port: 38888,
    password: "",
    dataMode: "production",
    workspaceMode: "production",
  },
};

export function resolveRuntimeRoot(env = process.env, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  return env.OPENCLAW_ENV_RUNTIME_ROOT || path.join(repoRoot, "data", "env");
}

export function resolveProductionDataDir(env = process.env, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  return env.OPENCLAW_PROD_DATA_DIR || path.join(repoRoot, "data");
}

export function resolveProductionWorkspace(env = process.env, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  return env.OPENCLAW_PROD_WORKSPACE || repoRoot;
}

export function buildServerEnv(name, sourceEnv = process.env, options = {}) {
  const config = WORKBENCH_ENVIRONMENTS[name];
  if (!config) {
    throw new Error(`Unknown OpenClaw environment "${name}". Expected dev, staging, or prod.`);
  }

  const repoRoot = options.repoRoot || process.cwd();
  const runtimeRoot = resolveRuntimeRoot(sourceEnv, { repoRoot });
  const isolatedRoot = path.join(runtimeRoot, name);
  const isProd = name === "prod";
  const dataDir = isProd ? resolveProductionDataDir(sourceEnv, { repoRoot }) : path.join(isolatedRoot, "data");
  const workspace = isProd ? resolveProductionWorkspace(sourceEnv, { repoRoot }) : path.join(isolatedRoot, "workspace");
  const password = isProd ? sourceEnv.OPENCLAW_WORKBENCH_PASSWORD || "" : config.password;

  const nextEnv = {
    ...sourceEnv,
    OPENCLAW_WORKBENCH_ENV: name,
    OPENCLAW_WORKBENCH_PORT: String(config.port),
    OPENCLAW_WORKBENCH_HOST: sourceEnv.OPENCLAW_WORKBENCH_HOST || "127.0.0.1",
    OPENCLAW_DATA_DIR: dataDir,
    OPENCLAW_WORKSPACE: workspace,
    OPENCLAW_WEB_DIST_DIR: sourceEnv.OPENCLAW_WEB_DIST_DIR || path.join(repoRoot, "apps", "web", "dist"),
  };

  if (password) nextEnv.OPENCLAW_WORKBENCH_PASSWORD = password;

  if (!isProd) {
    nextEnv.OPENCLAW_WORKBENCH_RESET_PASSWORD = sourceEnv.OPENCLAW_WORKBENCH_RESET_PASSWORD || "1";
    nextEnv.OPENCLAW_WORKBENCH_REMINDER_SYNC = sourceEnv.OPENCLAW_WORKBENCH_REMINDER_SYNC || "0";
    nextEnv.OPENCLAW_WORKBENCH_DISABLE_WIKI_SCHEDULER = sourceEnv.OPENCLAW_WORKBENCH_DISABLE_WIKI_SCHEDULER || "1";
    nextEnv.OPENCLAW_WORKBENCH_NAS_ROOT_SCAN = sourceEnv.OPENCLAW_WORKBENCH_NAS_ROOT_SCAN || "0";
    nextEnv.OPENCLAW_WORKBENCH_NAS_MOUNT_SCAN = sourceEnv.OPENCLAW_WORKBENCH_NAS_MOUNT_SCAN || "0";
  }

  return nextEnv;
}

export function requireAllowedOperation(operation, envName, sourceEnv = process.env) {
  if (envName === "prod" && sourceEnv.OPENCLAW_ALLOW_PROD_OPS !== "YES-I-KNOW") {
    throw new Error(`${operation} on prod requires OPENCLAW_ALLOW_PROD_OPS=YES-I-KNOW`);
  }
}

export function assertWritableSmokeTarget({ baseUrl, env, allowProdWrite = process.env.OPENCLAW_ALLOW_PROD_SMOKE_WRITE }) {
  const parsed = new URL(baseUrl);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const targetsProd = env === "prod" || port === "38888";
  if (targetsProd && allowProdWrite !== "YES-I-KNOW") {
    throw new Error(
      `refuses to run writable smoke against prod target ${baseUrl}; use dev/staging or set OPENCLAW_ALLOW_PROD_SMOKE_WRITE=YES-I-KNOW`,
    );
  }
}
