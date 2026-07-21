import React from "react";
import { View, type ViewStyle } from "react-native";
import { Color } from "@/constants/design";

type BrandGlyphProps = {
  size?: number;        // overall pixel size (square)
  color?: string;       // foreground (claws) color — defaults to on-primary white
  background?: string;  // background color — defaults to primary teal
  rounded?: boolean;    // apply rounded corners (default true)
  style?: ViewStyle;    // outer style overrides
};

/**
 * OpenClaw 3-claw glyph rendered with plain View + rounded-rect. No SVG dep.
 * Geometry is normalized to a 100x100 box; render at any `size` and stays crisp.
 *
 * Layout (per v4 brand spec, see scripts/make-brand-mark.py):
 *   - cap:    horizontal pill at y=32..47, width 74, full bleed
 *   - claws:  3 vertical pills at x=13/50/87, width 15
 *             outer two extend 10 units below center for asymmetry
 */
export function BrandGlyph({
  size = 48,
  color = Color.onPrimary,
  background = Color.primary,
  rounded = true,
  style,
}: BrandGlyphProps) {
  const capHeight = size * 0.15;
  const capWidth = size * 0.74;
  const clawWidth = size * 0.15;
  const clawTop = size * 0.32;
  const clawHeight = size * 0.40;
  const clawOuterExtra = size * 0.10;
  const clawSpacing = size * 0.37;
  const radius = rounded ? size * 0.22 : 0;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          backgroundColor: background,
          borderRadius: radius,
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: clawTop - capHeight / 2,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {/* Cap (horizontal pill) */}
      <View
        style={{
          width: capWidth,
          height: capHeight,
          backgroundColor: color,
          borderRadius: capHeight / 2,
        }}
      />
      {/* 3 vertical claws below cap */}
      <View
        style={{
          flexDirection: "row",
          gap: clawSpacing - clawWidth,
          marginTop: -capHeight * 0.18,
        }}
      >
        {[0, 1, 2].map((i) => {
          const h = clawHeight + (i === 0 || i === 2 ? clawOuterExtra : 0);
          return (
            <View
              key={i}
              style={{
                width: clawWidth,
                height: h,
                backgroundColor: color,
                borderRadius: clawWidth / 2,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}
