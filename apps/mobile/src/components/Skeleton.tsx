import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { Color, Motion, Radius, Space } from '@/constants/design';

type SkeletonProps = ViewProps & {
  width?: number | string;
  height?: number;
  radius?: number;
  variant?: 'text' | 'circle' | 'block';
  style?: ViewStyle;
};

const variantDefaults = {
  text: { height: 14, radius: Radius.xs },
  circle: { height: 40, radius: 999 },
  block: { height: 80, radius: Radius.sm },
};

/**
 * 极简骨架屏。Animated loop，0.6 透明度脉动。
 * 用于：loading 时的卡片/列表/徽章占位
 */
export function Skeleton({
  width = '100%',
  height,
  radius,
  variant = 'text',
  style,
  ...rest
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  const defaults = variantDefaults[variant];

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: Motion.duration.slower,
          easing: Easing.bezier(0.4, 0, 0.6, 1),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: Motion.duration.slower,
          easing: Easing.bezier(0.4, 0, 0.6, 1),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="加载中"
      {...rest}
      style={[
        styles.base,
        {
          width: width as ViewStyle['width'],
          height: height ?? defaults.height,
          borderRadius: radius ?? defaults.radius,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonText({ width = '100%', style }: { width?: number | string; style?: ViewStyle }) {
  return <Skeleton width={width} variant="text" style={style} />;
}

export function SkeletonRow({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ gap: Space.sm }, style]}>{children}</View>;
}

export function SkeletonCard({ rows = 3, style }: { rows?: number; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          backgroundColor: Color.surface,
          borderRadius: Radius.md,
          padding: Space.lg,
          gap: Space.md,
          borderWidth: 1,
          borderColor: Color.border,
        },
        style,
      ]}
    >
      <Skeleton variant="text" width="55%" height={18} />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="text" width={i === rows - 1 ? '70%' : '90%'} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Color.surfaceMuted,
  },
});
