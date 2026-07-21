import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Color, Radius, Space, Type } from '@/constants/design';

type Tone = 'neutral' | 'muted' | 'success' | 'warn' | 'info' | 'danger';

type EmptyStateProps = {
  icon?: string;
  title: string;
  description?: string;
  tone?: Tone;
  action?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
};

const toneStyles: Record<Tone, { bg: string; ink: string; ring: string; glyph: string }> = {
  neutral: { bg: Color.surfaceMuted, ink: Color.ink, ring: Color.border, glyph: Color.inkFaint },
  muted: { bg: Color.surfaceMuted, ink: Color.inkMuted, ring: Color.border, glyph: Color.inkFaint },
  success: { bg: Color.okSoft, ink: Color.okInk, ring: Color.okBorder, glyph: Color.okInk },
  warn: { bg: Color.warnSoft, ink: Color.warnInk, ring: Color.warnBorder, glyph: Color.warnInk },
  info: { bg: Color.infoSoft, ink: Color.infoInk, ring: Color.infoBorder, glyph: Color.infoInk },
  danger: { bg: Color.dangerSoft, ink: Color.dangerInk, ring: Color.dangerBorder, glyph: Color.dangerInk },
};

const sizeConfig = {
  sm: { glyph: 22, container: 56, titleType: 'h3' as const, gap: Space.sm },
  md: { glyph: 30, container: 72, titleType: 'h2' as const, gap: Space.md },
  lg: { glyph: 40, container: 96, titleType: 'h1' as const, gap: Space.lg },
};

/**
 * 空状态组件。统一"这里应该有内容"的信号，避免屏幕无数据时一片灰。
 */
export function EmptyState({
  icon = '∅',
  title,
  description,
  tone = 'muted',
  action,
  size = 'md',
}: EmptyStateProps) {
  const t = toneStyles[tone];
  const cfg = sizeConfig[size];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${title}${description ? `，${description}` : ''}`}
      style={[styles.container, { backgroundColor: t.bg, borderColor: t.ring, gap: cfg.gap }]}
    >
      <View
        style={[
          styles.glyphWrap,
          {
            width: cfg.container,
            height: cfg.container,
            borderRadius: Radius.pill,
            backgroundColor: Color.surface,
            borderColor: t.ring,
          },
        ]}
      >
        <Text style={[styles.glyph, { color: t.glyph, fontSize: cfg.glyph, lineHeight: cfg.glyph + 4 }]}>
          {icon}
        </Text>
      </View>
      <Text style={[Type[cfg.titleType], { color: t.ink, textAlign: 'center' }]}>{title}</Text>
      {description ? (
        <Text style={[Type.bodySm, { color: Color.inkMuted, textAlign: 'center', maxWidth: 280 }]}>
          {description}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: Space.xs }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Space.xl,
    paddingHorizontal: Space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  glyph: {
    fontWeight: '800',
  },
});
