/**
 * OpenClaw 移动端 Design System
 * 单一来源：色/字/间距/圆角/阴影/动画/触控目标
 * 所有 screen / component 必须从此处引用，禁止内联硬编码
 */

import { Platform } from 'react-native';

/* ---------------------------------------------------------------------------
 * 品牌色（Color）
 * 之前散落在 screens 里的 teal #0f766e / blue #2563eb / pastel 全部收口
 * 主色单一：teal-700。所有状态色由 bg+border+ink 三件套定义。
 * -------------------------------------------------------------------------- */
export const Color = {
  // 主品牌
  primary: '#0F766E',
  primarySoft: '#CCFBF1',
  primarySofter: '#F0FDFA',
  primaryDeep: '#0D5C56',
  onPrimary: '#FFFFFF',

  // 文字（4 级灰阶）
  ink: '#0F172A',
  inkMuted: '#475467',
  inkFaint: '#667085',
  inkDisabled: '#98A2B3',
  onDark: '#FFFFFF',
  onDarkMuted: 'rgba(255,255,255,0.78)',

  // 表面
  surface: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  surfaceSubtle: '#F5F7FB',
  surfaceOverlay: 'rgba(15,23,42,0.45)',
  border: '#E1E7EF',
  borderSoft: '#EDF2F7',
  borderStrong: '#D6DAE0',

  // 状态（每个状态 3 件套：ink + bg + border）
  okInk: '#027A48',
  okBg: '#ECFDF3',
  okBorder: '#A6F4C5',
  okSoft: '#F0FDF4',

  warnInk: '#B54708',
  warnBg: '#FFFAEB',
  warnBorder: '#FEDF89',
  warnSoft: '#FEF7E6',

  danger: '#B42318',
  dangerInk: '#B42318',
  dangerBg: '#FEF3F2',
  dangerBorder: '#FECDCA',
  dangerSoft: '#FFF5F5',

  infoInk: '#1849A9',
  infoBg: '#EFF8FF',
  infoBorder: '#B2DDFF',
  infoSoft: '#F5F9FF',

  // 录音（特殊状态）
  recording: '#DC2626',
  recordingSoft: '#FEE2E2',
  recordingPulse: 'rgba(220,38,38,0.18)',

  // 透明
  transparent: 'transparent',
  scrim: 'rgba(15,23,42,0.55)',
} as const;

export type ColorKey = keyof typeof Color;

/* ---------------------------------------------------------------------------
 * 字体（Typography）
 * iOS 用 SF Pro / Android 用 Roboto / 中文用系统字
 * 9 级：display(3) + heading(3) + body(3) + caption(2)
 * -------------------------------------------------------------------------- */
const sansFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

const monoFamily = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const Type = {
  // Display — 用于 hero / 大标题
  displayLg: { fontFamily: sansFamily, fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.6 },
  displayMd: { fontFamily: sansFamily, fontSize: 28, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.4 },
  displaySm: { fontFamily: sansFamily, fontSize: 22, lineHeight: 28, fontWeight: '800' as const, letterSpacing: -0.2 },

  // Heading
  h1: { fontFamily: sansFamily, fontSize: 18, lineHeight: 24, fontWeight: '800' as const },
  h2: { fontFamily: sansFamily, fontSize: 17, lineHeight: 24, fontWeight: '800' as const },
  h3: { fontFamily: sansFamily, fontSize: 15, lineHeight: 22, fontWeight: '800' as const },

  // Body
  bodyLg: { fontFamily: sansFamily, fontSize: 16, lineHeight: 24, fontWeight: '500' as const },
  body: { fontFamily: sansFamily, fontSize: 14, lineHeight: 22, fontWeight: '500' as const },
  bodySm: { fontFamily: sansFamily, fontSize: 13, lineHeight: 20, fontWeight: '500' as const },

  // Caption
  caption: { fontFamily: sansFamily, fontSize: 12, lineHeight: 18, fontWeight: '500' as const },
  captionBold: { fontFamily: sansFamily, fontSize: 12, lineHeight: 18, fontWeight: '800' as const },

  // Micro（标签/计数/版本号）
  micro: { fontFamily: sansFamily, fontSize: 11, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.2 },
  microBold: { fontFamily: sansFamily, fontSize: 11, lineHeight: 16, fontWeight: '900' as const, letterSpacing: 0.3 },

  // Mono（数字/时间码/版本号）
  mono: { fontFamily: monoFamily, fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  monoLg: { fontFamily: monoFamily, fontSize: 32, lineHeight: 38, fontWeight: '800' as const },
} as const;

/* ---------------------------------------------------------------------------
 * 间距（Spacing）— 4 的倍数
 * -------------------------------------------------------------------------- */
export const Space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

export type SpaceKey = keyof typeof Space;

/* ---------------------------------------------------------------------------
 * 圆角（Radius）
 * -------------------------------------------------------------------------- */
export const Radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  pill: 999,
} as const;

/* ---------------------------------------------------------------------------
 * 阴影（Shadow）— iOS 风格分层
 * -------------------------------------------------------------------------- */
export const Shadow = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  focus: {
    shadowColor: '#0F766E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.20,
    shadowRadius: 0,
    elevation: 0,
  },
} as const;

/* ---------------------------------------------------------------------------
 * 动画（Motion）
 * -------------------------------------------------------------------------- */
export const Motion = {
  duration: {
    instant: 80,
    fast: 140,
    base: 220,
    slow: 320,
    slower: 480,
  },
  easing: {
    // React Native Animated easing
    standard: 'ease-out' as const,
    decelerate: 'ease-out' as const,
    accelerate: 'ease-in' as const,
    sharp: 'cubic-bezier(0.2, 0, 0, 1)' as const,
  },
  spring: {
    gentle: { useNativeDriver: true, friction: 9, tension: 80 },
    snappy: { useNativeDriver: true, friction: 7, tension: 120 },
    bouncy: { useNativeDriver: true, friction: 5, tension: 140 },
  },
} as const;

/* ---------------------------------------------------------------------------
 * 尺寸（Size）— 触控目标
 * -------------------------------------------------------------------------- */
export const Size = {
  // 触控（iOS HIG ≥ 44，Android Material ≥ 48）
  touchMin: 44,
  // 按钮
  buttonSm: 36,
  buttonMd: 44,
  buttonLg: 50,
  // input
  inputMd: 44,
  inputLg: 52,
  // icon
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  // tab bar
  tabBarHeight: 64,
  // 进度
  hairline: 1,
} as const;

/* ---------------------------------------------------------------------------
 * 导出聚合
 * -------------------------------------------------------------------------- */
export const Design = {
  Color,
  Type,
  Space,
  Radius,
  Shadow,
  Motion,
  Size,
} as const;

export type DesignToken = typeof Design;
