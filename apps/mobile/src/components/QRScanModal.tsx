// 2026-07-06 — R17: QR 扫码配对 modal。
//
// 桌面端工作台已经显示 QR 码(openclaw://pair?server=<url>&code=<6-digit>);
// 手机端用这个 modal 拉起扫码 UI,识别到 OpenClaw 配对 payload 后
// 调用 onScanned(payload),由父组件统一填入 server + code 并触发配对。
//
// 三条路径(graceful degrade):
//   1. native expo-camera 模块可用 + 已授权 → 实时 CameraView 扫码。
//   2. native 模块不可用 / 权限被拒 → 走"剪贴板 / 手动粘贴"两条 fallback,
//      把内容送回 extractPairingPayloadFromText 解析。
//   3. 解析失败 / 不是 OpenClaw 配对 QR → 显示红色 reason,让用户重试。
//
// 设计要点:
//   - 不在 modal 内部直接触发配对;统一回 onScanned,父组件控制状态。
//   - modal 必须有可见的 testID:R17 contract test 用来抓取。
//   - 用户取消:onClose 必须能跑(空函数也行),Modal 要立刻消失。
//   - 没有 native camera 时,**不要崩溃** —— 给出明确"手动粘贴"路径。

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Color, Radius, Space, Type } from "@/constants/design";
import { extractPairingPayloadFromText, isQRScanPayload, type QRScanPermissionState } from "@/lib/qrPairing";

type QRScanModalProps = {
  visible: boolean;
  /** native 端是否暴露了 expo-camera(动态 import 成功) */
  scannerAvailable: boolean;
  /** 相机权限状态 */
  scannerPermission: QRScanPermissionState;
  /** 父组件传入的初始 error(剪贴板空 / 权限拒绝等),modal 内显示 */
  initialError?: string;
  /** 关闭 modal */
  onClose: () => void;
  /** 扫描 / 解析成功后回传原始 payload 字符串 */
  onScanned: (payload: string) => void;
  /** 触发权限请求(父组件决定如何调用) */
  onRequestPermission: () => void;
};

export function QRScanModal({
  visible,
  scannerAvailable,
  scannerPermission,
  initialError,
  onClose,
  onScanned,
  onRequestPermission,
}: QRScanModalProps) {
  const [manualText, setManualText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setError(initialError || "");
      setManualText("");
    }
  }, [visible, initialError]);

  // R17: 相机扫码 —— 仅在 native 模块可用 + 权限已授予时启用。
  // expo-camera 在 R17 当前构建里可能还没装,所以做成动态 import,缺了降级。
  type CameraViewComponent = React.ComponentType<{
    onBarcodeScanned?: (event: { data?: string }) => void;
    style?: object;
    facing?: string;
    barcodeScannerSettings?: { barcodeTypes?: string[] };
  }>;
  const [cameraView, setCameraView] = useState<null | { CameraView: CameraViewComponent }>(null);
  useEffect(() => {
    if (!visible) return;
    if (!scannerAvailable) return;
    if (scannerPermission !== "granted") return;
    let cancelled = false;
    (async () => {
      try {
        // @ts-ignore — expo-camera is an optional native dep; resolves to null at runtime when missing.
        const mod = await import("expo-camera").catch(() => null);
        if (cancelled || !mod) return;
        const CV = (mod as { CameraView?: unknown }).CameraView;
        if (typeof CV !== "function") return;
        setCameraView({ CameraView: CV as unknown as CameraViewComponent });
      } catch {
        // ignore — fallback to manual
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, scannerAvailable, scannerPermission]);

  const submitManual = useCallback(() => {
    const text = manualText.trim();
    if (!text) {
      setError("请粘贴 QR 内容,或从剪贴板读取。");
      return;
    }
    if (!isQRScanPayload(text)) {
      setError(`看起来不是 OpenClaw 配对 QR 码: "${text.slice(0, 32)}${text.length > 32 ? "…" : ""}"`);
      return;
    }
    const parsed = extractPairingPayloadFromText(text);
    if (!parsed) {
      setError("QR 码格式不识别(应包含 server= 和 code= 两个参数)。");
      return;
    }
    setError("");
    onScanned(text);
  }, [manualText, onScanned]);

  const onBarcodeScanned = useCallback(
    (event: { data?: string }) => {
      const data = String(event?.data || "").trim();
      if (!data) return;
      setBusy(true);
      // 立即关掉扫码,避免重复触发
      setCameraView(null);
      // 把扫描结果直接交给父组件解析
      onScanned(data);
      setTimeout(() => setBusy(false), 200);
    },
    [onScanned],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="关闭扫码"
        onPress={onClose}
        style={styles.scrim}
        testID="mobile-qr-scan-scrim"
      >
        <Pressable onPress={() => { /* swallow — let the inner view handle taps */ }} style={styles.card} testID="mobile-qr-scan-modal">
          <View style={styles.headerRow}>
            <Text style={styles.title}>扫码配对 Mac 工作台</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭扫码"
              testID="mobile-qr-scan-close"
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.closeBtnText}>关闭</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* 实时相机扫码 —— 仅在 native 模块可用 + 已授权时启用 */}
            {scannerAvailable && scannerPermission === "granted" && cameraView ? (
              <View style={styles.cameraWrap} testID="mobile-qr-scan-camera">
                <cameraView.CameraView
                  style={styles.camera}
                  facing="back"
                  onBarcodeScanned={onBarcodeScanned}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                />
                <View style={styles.cameraFrame}>
                  <View style={[styles.cameraCorner, styles.cameraCornerTL]} />
                  <View style={[styles.cameraCorner, styles.cameraCornerTR]} />
                  <View style={[styles.cameraCorner, styles.cameraCornerBL]} />
                  <View style={[styles.cameraCorner, styles.cameraCornerBR]} />
                </View>
                <Text style={styles.cameraHint}>对准桌面端系统设置里的二维码</Text>
              </View>
            ) : scannerAvailable && scannerPermission === "unknown" ? (
              <View style={styles.cameraPermissionGate} testID="mobile-qr-scan-permission-gate">
                <Text style={styles.bodyText}>
                  需要相机权限才能扫码。允许后才会拉起实时扫码界面。
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="允许相机权限"
                  testID="mobile-qr-scan-request-permission"
                  onPress={onRequestPermission}
                  style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.primaryBtnText}>允许相机权限</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.fallbackPanel} testID="mobile-qr-scan-fallback">
                <Text style={styles.fallbackTitle}>
                  {scannerAvailable
                    ? "相机权限被拒 / 不可用"
                    : "相机扫码模块未装载"}
                </Text>
                <Text style={styles.bodyText}>
                  {scannerAvailable
                    ? "可在系统设置 → 应用 → OpenClaw → 权限中重新允许相机,然后回到这里再次尝试。"
                    : "当前 APK 是基于 expo-camera 接入前构建的;后续 native rebuild 会自带相机扫码。"}
                </Text>
                <Text style={styles.bodyText}>
                  暂时可以走下面任一路径:
                </Text>
                <View style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bodyText}>
                    桌面端生成 QR 码时复制 openclaw://pair?... 链接,在下方粘贴
                  </Text>
                </View>
                <View style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bodyText}>
                    或直接在下方输入 Mac 地址 + 6 位配对码
                  </Text>
                </View>
              </View>
            )}

            {/* 手动粘贴 + 剪贴板 — 不依赖相机,所有构建都能用 */}
            <View style={styles.manualPanel} testID="mobile-qr-scan-manual">
              <Text style={styles.sectionTitle}>手动粘贴</Text>
              <TextInput
                value={manualText}
                onChangeText={setManualText}
                placeholder="openclaw://pair?server=...&code=123456"
                placeholderTextColor="#98a2b3"
                multiline
                style={styles.input}
                testID="mobile-qr-scan-manual-input"
                accessibilityLabel="QR 内容"
              />
              <View style={styles.manualBtnRow}>
                <Pressable
                  onPress={submitManual}
                  accessibilityRole="button"
                  accessibilityLabel="解析并填入"
                  testID="mobile-qr-scan-manual-submit"
                  style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.7 }]}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>解析并填入</Text>}
                </Pressable>
                <Pressable
                  onPress={async () => {
                    try {
                      // @ts-ignore — expo-clipboard is optional; native dep installed in a later rebuild.
                      const Clipboard = await import("expo-clipboard").catch(() => null);
                      if (!Clipboard || typeof Clipboard.getStringAsync !== "function") {
                        setError("剪贴板模块未装载,无法读取。");
                        return;
                      }
                      const text = await Clipboard.getStringAsync();
                      if (!text) {
                        setError("剪贴板为空。");
                        return;
                      }
                      setManualText(text);
                      setError("");
                    } catch (err) {
                      setError(`读取剪贴板失败: ${err instanceof Error ? err.message : String(err)}`);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="从剪贴板读取"
                  testID="mobile-qr-scan-manual-clipboard"
                  style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.secondaryBtnText}>从剪贴板读取</Text>
                </Pressable>
              </View>
            </View>

            {error ? (
              <View style={styles.errorPanel} testID="mobile-qr-scan-error">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {scannerAvailable && scannerPermission === "denied" ? (
              <Pressable
                onPress={onRequestPermission}
                accessibilityRole="button"
                accessibilityLabel="重新请求相机权限"
                testID="mobile-qr-scan-retry-permission"
                style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.secondaryBtnText}>重新请求相机权限</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: Color.surface || "#fff",
    borderTopLeftRadius: Radius.lg || 12,
    borderTopRightRadius: Radius.lg || 12,
    maxHeight: "88%",
    minHeight: 360,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Color.border || "#e5e7eb",
  },
  title: { ...Type.h2, color: Color.ink || "#111827", fontWeight: "900" },
  closeBtn: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md || 8,
    backgroundColor: Color.surfaceMuted || "#f3f4f6",
  },
  closeBtnText: { ...Type.captionBold, color: Color.primary || "#0f766e" },
  body: { padding: Space.md, gap: Space.md, paddingBottom: Space.xl },
  cameraWrap: {
    borderRadius: Radius.md || 8,
    overflow: "hidden",
    height: 260,
    position: "relative",
    backgroundColor: "#000",
  },
  camera: { width: "100%", height: "100%" },
  cameraFrame: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraCorner: {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: "#10b981",
  },
  cameraCornerTL: { top: 28, left: 28, borderTopWidth: 4, borderLeftWidth: 4 },
  cameraCornerTR: { top: 28, right: 28, borderTopWidth: 4, borderRightWidth: 4 },
  cameraCornerBL: { bottom: 28, left: 28, borderBottomWidth: 4, borderLeftWidth: 4 },
  cameraCornerBR: { bottom: 28, right: 28, borderBottomWidth: 4, borderRightWidth: 4 },
  cameraHint: {
    position: "absolute",
    bottom: 8,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingVertical: 4,
    ...Type.caption,
  },
  cameraPermissionGate: {
    padding: Space.md,
    borderRadius: Radius.md || 8,
    backgroundColor: Color.warnSoft || "#fff7ed",
    borderWidth: 1,
    borderColor: Color.warnBorder || "#fde68a",
    gap: Space.sm,
  },
  fallbackPanel: {
    padding: Space.md,
    borderRadius: Radius.md || 8,
    backgroundColor: Color.dangerSoft || "#fef2f2",
    borderWidth: 1,
    borderColor: Color.dangerBorder || "#fecaca",
    gap: Space.xs,
  },
  fallbackTitle: { ...Type.bodySm, color: Color.dangerInk || "#dc2626", fontWeight: "900" },
  bodyText: { ...Type.caption, color: Color.inkMuted || "#374151" },
  bulletRow: { flexDirection: "row", gap: Space.xs, alignItems: "flex-start" },
  bulletDot: { ...Type.caption, color: Color.inkMuted || "#374151", fontWeight: "900" },
  manualPanel: {
    padding: Space.md,
    borderRadius: Radius.md || 8,
    backgroundColor: Color.surface || "#fff",
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    gap: Space.sm,
  },
  sectionTitle: { ...Type.body, color: Color.ink || "#111827", fontWeight: "900" },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    borderRadius: Radius.md || 8,
    padding: Space.sm,
    textAlignVertical: "top",
    color: Color.ink || "#111827",
  },
  manualBtnRow: { flexDirection: "row", gap: Space.sm, alignItems: "center" },
  primaryBtn: {
    flex: 1,
    backgroundColor: Color.primary || "#0f766e",
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md || 8,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { ...Type.bodySm, color: "#fff", fontWeight: "900" },
  secondaryBtn: {
    flex: 1,
    backgroundColor: Color.surfaceMuted || "#f3f4f6",
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md || 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { ...Type.bodySm, color: Color.ink || "#111827", fontWeight: "900" },
  errorPanel: {
    padding: Space.md,
    borderRadius: Radius.md || 8,
    backgroundColor: Color.dangerSoft || "#fef2f2",
    borderWidth: 1,
    borderColor: Color.dangerBorder || "#fecaca",
  },
  errorText: { ...Type.bodySm, color: Color.dangerInk || "#dc2626", fontWeight: "800" },
});
