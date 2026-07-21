import type { PropsWithChildren } from 'react';
import { Linking, Pressable, Text, type TextStyle } from 'react-native';

type Props = PropsWithChildren<{
  href: string;
  style?: TextStyle;
}>;

export function ExternalLink({ children, href, style }: Props) {
  return (
    <Pressable onPress={() => Linking.openURL(href)}>
      <Text style={style}>{children}</Text>
    </Pressable>
  );
}
