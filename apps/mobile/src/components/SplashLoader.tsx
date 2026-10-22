import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, spacing } from '../theme';

const SIZE = 36;
const STROKE = 3.5;

/**
 * Material-style spinner without SVG: two quarter-arcs spin at different speeds and easings,
 * so together the visible arc keeps growing and shrinking like Google's loader.
 * Each arc is a full ring clipped to one quadrant; Android ignores per-side border colours on rounded views.
 */
function Spinner() {
  const steady = useRef(new Animated.Value(0)).current;
  const surge = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loops = [
      Animated.loop(Animated.timing(steady, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.timing(surge, { toValue: 1, duration: 1650, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true })),
    ];
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [steady, surge]);
  const spin = (value: Animated.Value, turns: number) => ({
    transform: [{ rotate: value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${360 * turns}deg`] }) }],
  });
  return (
    <View style={styles.spinner} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <View style={[styles.ring, styles.track]} />
      <Animated.View style={[styles.ring, spin(steady, 1)]}><View style={styles.quadrant}><View style={[styles.ring, styles.arc]} /></View></Animated.View>
      <Animated.View style={[styles.ring, spin(surge, 2)]}><View style={styles.quadrant}><View style={[styles.ring, styles.arc]} /></View></Animated.View>
    </View>
  );
}

/** Shown from the native splash until the app has checked its version and restored the session. */
export function SplashLoader({ message }: Readonly<{ message?: string }>) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [fade]);
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Animated.View style={[styles.brand, { opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
        <Image source={require('../../assets/logo.png')} style={styles.logo} />
        <Text style={styles.wordmark}>BizNexa</Text>
        <Text style={styles.tagline}>Business registration & compliance</Text>
      </Animated.View>
      <View style={styles.footer}>
        <Spinner />
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  brand: { alignItems: 'center' },
  logo: { width: 96, height: 96, borderRadius: 22 },
  wordmark: { marginTop: spacing.lg, fontSize: 34, fontWeight: '800', color: colors.white, letterSpacing: -0.5 },
  tagline: { marginTop: spacing.xs, fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  footer: { position: 'absolute', bottom: 96, alignItems: 'center' },
  spinner: { width: SIZE, height: SIZE },
  ring: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  track: { borderWidth: STROKE, borderColor: 'rgba(255,255,255,0.15)' },
  quadrant: { width: SIZE / 2, height: SIZE / 2, overflow: 'hidden' },
  arc: { borderWidth: STROKE, borderColor: colors.marigold },
  message: { marginTop: spacing.md, fontSize: 13, color: 'rgba(255,255,255,0.7)' },
});
