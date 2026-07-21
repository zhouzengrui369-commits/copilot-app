/**
 * 轻量 Haptics 封装。暂用 RN 自带 Vibration。
 * 后续如要更精细的 iOS CoreHaptics 反馈可升级 expo-haptics（P1 考虑）。
 */
import { Platform, Vibration } from 'react-native';

const isIOS = Platform.OS === 'ios';

const tap = isIOS ? 8 : 12;
const med = isIOS ? 18 : 24;
const lng = isIOS ? 30 : 40;

export const Haptics = {
  /** 极轻触：tab 切换、配对输入完成 */
  tick(): void {
    Vibration.vibrate(tap);
  },
  /** 轻触：按钮按下 */
  light(): void {
    Vibration.vibrate(tap + 4);
  },
  /** 中触：保存成功、录音停止 */
  success(): void {
    Vibration.vibrate(med);
  },
  /** 重触：录音开始、上限警告 */
  heavy(): void {
    Vibration.vibrate(lng);
  },
  /** 错误：失败重试、错误提示 */
  error(): void {
    Vibration.vibrate([0, lng, 60, lng, 60, lng]);
  },
  /** 警告：即将到达录音上限 */
  warn(): void {
    Vibration.vibrate([0, med, 80, med]);
  },
} as const;
