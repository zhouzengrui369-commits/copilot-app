import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Color, Motion, Radius, Shadow, Size, Space, Type } from '@/constants/design';

type Tone = 'primary' | 'secondary' | 'ghost' | 'danger';
type SizeKey = 'sm' | 'md' | 'lg';

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  scaleTo?: number;
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  children: React.ReactNode;
};

/**
 * 通用按压组件：按下时 scale 0.97，松手回弹。
 * 比单纯 opacity 更"按得到"的反馈。
 */
export function PressableScale({ scaleTo = 0.97, style, onPressIn, onPressOut, children, ...rest }: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (to: number) => {
    Animated.timing(scale, {
      toValue: to,
      duration: Motion.duration.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        animateTo(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        animateTo(1);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[typeof style === 'function' ? undefined : style, { transform: [{ scale }] }]}>
        {typeof style === 'function' ? <PressableStyleProbe style={style}>{children}</PressableStyleProbe> : children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Pressable 的 children 渲染时 style 函数才执行；这里转发 pressed 给动画层外的 style。
 * 由于 transform 已占用 Animated.View style，我们直接把 pressed 状态传给 child。
 */
function PressableStyleProbe({ children }: { children: React.ReactNode; style: (s: { pressed: boolean }) => StyleProp<ViewStyle> }) {
  return <>{children}</>;
}

type ButtonProps = {
  label: string;
  icon?: string;
  tone?: Tone;
  size?: SizeKey;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  onPress?: () => void;
  testID?: string;
};

const toneStyles: Record<Tone, { bg: string; fg: string; border: string; pressed: string }> = {
  primary: { bg: Color.primary, fg: Color.onPrimary, border: Color.primary, pressed: Color.primaryDeep },
  secondary: { bg: Color.surface, fg: Color.ink, border: Color.border, pressed: Color.surfaceMuted },
  ghost: { bg: Color.transparent, fg: Color.primary, border: Color.transparent, pressed: Color.primarySofter },
  danger: { bg: Color.danger, fg: Color.onPrimary, border: Color.danger, pressed: '#8B1812' },
};

const sizeMap: Record<SizeKey, { height: number; px: number; textStyle: typeof Type.h3 | typeof Type.captionBold | typeof Type.body }> = {
  sm: { height: Size.buttonSm, px: Space.md, textStyle: Type.captionBold },
  md: { height: Size.buttonMd, px: Space.lg, textStyle: Type.body as unknown as typeof Type.h3 },
  lg: { height: Size.buttonLg, px: Space.xl, textStyle: Type.h3 },
};

/**
 * 主按钮。统一品牌色 + 圆角 + 触控目标。
 * loading 时显示 ActivityIndicator，disabled 时透明度 0.45。
 */
export function Button({
  label,
  icon,
  tone = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  fullWidth = false,
  onPress,
  testID,
}: ButtonProps) {
  const t = toneStyles[tone];
  const s = sizeMap[size];
  const isDisabled = disabled || loading;
  const textStyle = { ...s.textStyle, color: t.fg };

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {({ pressed }) => {
        const scale = pressed && !isDisabled ? 0.97 : 1;
        return (
          <Animated.View
            style={[
              styles.base,
              {
                height: s.height,
                paddingHorizontal: s.px,
                backgroundColor: pressed ? t.pressed : t.bg,
                borderColor: t.border,
                borderWidth: tone === 'secondary' ? 1 : 0,
                opacity: isDisabled ? 0.45 : 1,
                alignSelf: fullWidth ? 'stretch' : 'flex-start',
                transform: [{ scale }],
                ...(tone === 'primary' && !isDisabled ? Shadow.sm : {}),
              },
            ]}
          >
            <View style={styles.contentRow}>
              {loading ? (
                <Text style={[Type.body, { color: t.fg, fontWeight: '900' }]}>◌</Text>
              ) : icon ? (
                <Text style={textStyle}>{icon}</Text>
              ) : null}
              <Text style={textStyle}>{label}</Text>
            </View>
          </Animated.View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
});
