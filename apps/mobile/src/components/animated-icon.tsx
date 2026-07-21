import { Image, StyleSheet, Text, View } from 'react-native';

export function AnimatedSplashOverlay() {
  return (
    <View style={styles.backgroundSolidColor}>
      <Text style={styles.splashText}>OpenClaw</Text>
    </View>
  );
}

export function AnimatedIcon() {
  return (
    <View style={styles.iconContainer}>
      <View style={styles.background} />
      <View style={styles.imageContainer}>
        <Image style={styles.image} source={require('@/assets/images/expo-logo.png')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 128,
    height: 128,
    zIndex: 100,
  },
  image: {
    position: 'absolute',
    width: 76,
    height: 71,
  },
  background: {
    borderRadius: 40,
    backgroundColor: '#208AEF',
    width: 128,
    height: 128,
    position: 'absolute',
  },
  backgroundSolidColor: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#208AEF',
    zIndex: 1000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
});
