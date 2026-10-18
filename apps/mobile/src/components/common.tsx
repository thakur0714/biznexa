import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextStyle,
  type ViewStyle,
  type TextInputProps,
  ActivityIndicator,
} from 'react-native';
import { colors, radius, spacing } from '../theme';

export interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}

export function Card({ children, style, onPress }: CardProps) {
  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        style={[styles.card, style]}
      >
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const buttonVariantStyle = {
    primary: styles.btnPrimary,
    secondary: styles.btnSecondary,
    accent: styles.btnAccent,
    danger: styles.btnDanger,
    ghost: styles.btnGhost,
  }[variant];

  const buttonSizeStyle = {
    sm: styles.btnSm,
    md: styles.btnMd,
    lg: styles.btnLg,
  }[size];

  const textVariantStyle = {
    primary: styles.btnTextPrimary,
    secondary: styles.btnTextSecondary,
    accent: styles.btnTextAccent,
    danger: styles.btnTextDanger,
    ghost: styles.btnTextGhost,
  }[variant];

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.btnBase,
        buttonVariantStyle,
        buttonSizeStyle,
        disabled && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' || variant === 'ghost' ? colors.ink : colors.white}
          size="small"
        />
      ) : (
        <Text style={[styles.btnTextBase, textVariantStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, containerStyle, style, ...props }: InputProps) {
  return (
    <View style={[styles.inputContainer, containerStyle]}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.inputField, error ? styles.inputError : undefined, style]}
        {...props}
      />
      {error && <Text style={styles.inputErrorText}>{error}</Text>}
    </View>
  );
}

export interface BadgeProps {
  label: string;
  variant?: 'seal' | 'marigold' | 'ink' | 'danger' | 'neutral';
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function Badge({ label, variant = 'seal', style, textStyle }: BadgeProps) {
  const badgeStyle = {
    seal: styles.badgeSeal,
    marigold: styles.badgeMarigold,
    ink: styles.badgeInk,
    danger: styles.badgeDanger,
    neutral: styles.badgeNeutral,
  }[variant];

  const badgeTextStyle = {
    seal: styles.badgeTextSeal,
    marigold: styles.badgeTextMarigold,
    ink: styles.badgeTextInk,
    danger: styles.badgeTextDanger,
    neutral: styles.badgeTextNeutral,
  }[variant];

  return (
    <View style={[styles.badgeBase, badgeStyle, style]}>
      <Text style={[styles.badgeTextBase, badgeTextStyle, textStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.lg,
    shadowColor: colors.night,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  btnBase: {
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnPrimary: {
    backgroundColor: colors.ink,
  },
  btnSecondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  btnAccent: {
    backgroundColor: colors.marigold,
  },
  btnDanger: {
    backgroundColor: colors.danger,
  },
  btnGhost: {
    backgroundColor: colors.transparent,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnSm: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
  },
  btnMd: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md + 4,
  },
  btnLg: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  btnTextBase: {
    fontWeight: '600',
    fontSize: 14,
  },
  btnTextPrimary: {
    color: colors.white,
  },
  btnTextSecondary: {
    color: colors.night,
  },
  btnTextAccent: {
    color: colors.night,
  },
  btnTextDanger: {
    color: colors.white,
  },
  btnTextGhost: {
    color: colors.ink,
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.night,
    marginBottom: spacing.xs,
  },
  inputField: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.night,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputErrorText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 2,
  },
  badgeBase: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeSeal: {
    backgroundColor: colors.seal050,
  },
  badgeMarigold: {
    backgroundColor: colors.amber050,
  },
  badgeInk: {
    backgroundColor: colors.ink050,
  },
  badgeDanger: {
    backgroundColor: colors.danger050,
  },
  badgeNeutral: {
    backgroundColor: colors.paper,
  },
  badgeTextBase: {
    fontSize: 11,
    fontWeight: '600',
  },
  badgeTextSeal: {
    color: colors.seal,
  },
  badgeTextMarigold: {
    color: colors.amber,
  },
  badgeTextInk: {
    color: colors.ink,
  },
  badgeTextDanger: {
    color: colors.danger,
  },
  badgeTextNeutral: {
    color: colors.muted,
  },
});
