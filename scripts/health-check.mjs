const base = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const timeoutMs = Number(process.env.OPENCLAW_WORKBENCH_HEALTH_TIMEOUT_MS || 15000);
const attempts = Number(process.env.OPENCLAW_WORKBENCH_HEALTH_ATTEMPTS || 3);

async function checkOnce() {
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(`status ${res.status}`);
  }
  const deliveryRes = await fetch(`${base}/delivery?health=1`, { signal: AbortSignal.timeout(timeoutMs) });
  const deliveryHtml = await deliveryRes.text();
  if (!deliveryRes.ok) {
    throw new Error(`delivery status ${deliveryRes.status}`);
  }
  if (!deliveryHtml.includes('id="root"') || !/assets\/index-.*\.js/.test(deliveryHtml)) {
    throw new Error("delivery html missing Workbench root or app bundle");
  }
  return data;
}

async function main() {
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const data = await checkOnce();
      console.log(`Workbench health ok: ${data.service} ${data.ts}`);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    }
  }
  console.error(`Workbench health failed after ${attempts} attempts: ${lastError}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`Workbench health failed: ${err.message}`);
  process.exit(1);
});
