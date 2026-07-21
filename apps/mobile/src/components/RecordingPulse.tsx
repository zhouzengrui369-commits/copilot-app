import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { Color, Motion, Space, Type } from '@/constants/design';

type RecordingPulseProps = {
  active: boolean;
  size?: number;
  /** 主色（默认红色）；如需品牌色传 Color.primary */
  color?: string;
  /** 背景脉动色 */
  glowColor?: string;
};

/**
 * 录音中圆形脉动指示器。
 * 1 个核心点 + 2 层错相位 pulse 圆环 + 旋转扫线。
 * active=false 时静态显示一个 "麦" 字。
 */
export function RecordingPulse({
  active,
  size = 88,
  color = Color.recording,
  glowColor = Color.recordingPulse,
}: RecordingPulseProps) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      ring1.stopAnimation();
      ring2.stopAnimation();
      rotate.stopAnimation();
      ring1.setValue(0);
      ring2.setValue(0);
      rotate.setValue(0);
      return;
    }

    const ring1Loop = Animated.loop(
      Animated.timing(ring1, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    const ring2Loop = Animated.loop(
      Animated.timing(ring2, {
        toValue: 1,
        duration: 1600,
        delay: 800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    const rotateLoop = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    ring1Loop.start();
    ring2Loop.start();
    rotateLoop.start();

    return () => {
      ring1Loop.stop();
      ring2Loop.stop();
      rotateLoop.stop();
    };
  }, [active, ring1, ring2, rotate]);

  const ringStyle = (anim: Animated.Value) => ({
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: glowColor,
    transform: [
      {
        scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.8] }),
      },
    ],
    opacity: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.55, 0.25, 0] }),
  });

  const rotateStyle = {
    transform: [
      {
        rotate: rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
      },
    ],
  };

  return (
    <View style={{ width: size + 32, height: size + 32, alignItems: 'center', justifyContent: 'center' }}>
      {active ? (
        <>
          <Animated.View pointerEvents="none" style={ringStyle(ring1)} />
          <Animated.View pointerEvents="none" style={ringStyle(ring2)} />
        </>
      ) : null}
      <View
        style={[
          styles.core,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: active ? color : Color.surfaceMuted,
            borderColor: active ? Color.surface : Color.border,
          },
          shadowSoft,
        ]}
      >
        {active ? (
          <Animated.View
            style={[
              styles.scanLine,
              { width: size * 0.78, height: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
              rotateStyle,
            ]}
          />
        ) : (
          <Text style={[Type.h1, { color: Color.inkDisabled, fontSize: 22, lineHeight: 26 }]}>麦</Text>
        )}
      </View>
    </View>
  );
}

const shadowSoft = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.18,
  shadowRadius: 14,
  elevation: 6,
} as const;

const styles = StyleSheet.create({
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
  },
  scanLine: {
    borderRadius: 1,
  },
});

void Motion;
void Space;
