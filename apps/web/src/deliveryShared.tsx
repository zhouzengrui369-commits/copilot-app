// deliveryShared — DeliveryCore 三栏布局共用的基础设施
//
// 包含:
//   * ApiState<T> — API 状态类型 (loading/data/error)
//   * ApiError — 带 details 的 fetch 错误类
//   * api<T>(path, init?) — 通用 fetch 封装, 处理 ok=false 错误
//   * useApi<T>(path, deps) — React hook, 监听 deps 自动重拉
//   * NOTE_ORGANIZE_CLIENT_TIMEOUT_MINUTES — 超时常量
//
// 这些是从 App.tsx 抽出来的共用工具, 被 DeliveryLeftRail / DeliveryCenterPane /
// DeliveryRightRail 三个新组件复用, 避免在每个新文件里重复实现 fetch 错误处理。
//
// 设计:
//   * 不引新依赖, 只用 fetch + React
//   * 与 App.tsx 中同名函数完全等价 (一字不差迁移)
//   * App.tsx 现有的 api() / useApi() 函数保留, 内部其它功能继续使用 (避免大爆炸重命名)
//
import { useEffect, useState } from "react";

export const NOTE_ORGANIZE_CLIENT_TIMEOUT_MINUTES = 30;

export type ApiState<T> = { loading: boolean; data?: T; error?: string };

export class ApiError extends Error {
  details: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.details = details;
  }
}

function toDisplayError(input: unknown): string {
  if (input instanceof Error) return input.message;
  return String(input || "");
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`请求已取消或超过 ${NOTE_ORGANIZE_CLIENT_TIMEOUT_MINUTES} 分钟等待上限；若已创建后台整理任务，Worker 运维与 Gateway/MiniMax 重试会继续记录状态。`);
    }
    throw new Error(toDisplayError(err instanceof Error ? err.message : String(err)));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const details = [
      data.message || data.error || res.statusText,
      data.reasonLabel,
      data.stage && `stage=${data.stage}`,
      data.reason && `reason=${data.reason}`,
      data.debugReportPath && `debugReport=${data.debugReportPath}`,
      data.advice,
    ].filter(Boolean).join("；");
    throw new ApiError(toDisplayError(details), data);
  }
  return data as T;
}

export function useApi<T>(path: string, deps: unknown[] = []): ApiState<T> & { refresh?: () => void } {
  const [state, setState] = useState<ApiState<T>>({ loading: true });
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path)
      .then((data) => alive && setState({ loading: false, data }))
      .catch((err) => alive && setState((current) => ({ ...current, loading: false, error: err.message })));
    return () => {
      alive = false;
    };
  }, [...deps, refreshKey]);
  return { ...state, refresh: () => setRefreshKey((value) => value + 1) };
}

export function compactPathLabel(input: unknown, maxChars = 72): string {
  const raw = String(input || "").replace(/\\/g, "/").replace(/\s+/g, " ").trim();
  if (!raw || raw.length <= maxChars) return raw;
  const parts = raw.split("/").filter(Boolean);
  if (parts.length <= 2) return `...${raw.slice(Math.max(0, raw.length - maxChars + 3))}`;
  const file = parts[parts.length - 1] || "";
  const parent = parts[parts.length - 2] || "";
  const grandparent = parts[parts.length - 3] || "";
  let label = `.../${[grandparent, parent, file].filter(Boolean).join("/")}`;
  if (label.length <= maxChars) return label;
  label = `.../${[parent, file].filter(Boolean).join("/")}`;
  if (label.length <= maxChars) return label;
  return `.../${file.slice(Math.max(0, file.length - maxChars + 4))}`;
}
