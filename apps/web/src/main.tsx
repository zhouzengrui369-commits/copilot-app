import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

type BootBoundaryState = { error: string; detail: string; route: string; refreshedAt: string };

class BootErrorBoundary extends React.Component<React.PropsWithChildren, BootBoundaryState> {
  state: BootBoundaryState = { error: "", detail: "", route: "", refreshedAt: "" };

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "unknown_error");
    const route = typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return {
      error: message,
      detail: error instanceof Error ? error.stack || "" : "",
      route,
      refreshedAt: new Date().toLocaleString(),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("Workbench bootstrap failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const short = this.state.error.slice(0, 180) || "Workbench 启动失败";
    return (
      <div className="boot-error-shell">
        <div className="boot-error-card">
          <strong>OpenClaw Workbench 启动失败</strong>
          <p>当前路径：{this.state.route || "未知路由"}</p>
          <p><strong>错误摘要：</strong>{short}</p>
          {this.state.detail ? <p className="muted" style={{ whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>{this.state.detail}</p> : null}
          <div className="button-row">
            <button type="button" onClick={() => window.location.reload()}>刷新页面</button>
            <button type="button" className="secondary" onClick={() => window.location.assign("/")}>回到首页</button>
            <button type="button" className="secondary" onClick={() => window.history.back()}>返回上一页</button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>检测时间：{this.state.refreshedAt}</p>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <App />
    </BootErrorBoundary>
  </React.StrictMode>
);
