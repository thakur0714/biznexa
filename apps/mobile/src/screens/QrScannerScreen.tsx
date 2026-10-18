import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';
import { Button } from '../components/common';

interface QrScannerScreenProps {
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: {
    params?: {
      onScan?: (certNumber: string) => void;
    };
  };
}

export function QrScannerScreen({ navigation, route }: QrScannerScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const handleBarCodeScanned = ({ data }: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);

    let certNumber = data.trim();
    // Parse URL if QR contains a verification link e.g. https://biznexa.in/verify?number=BN-ISO-001 or ?id=...
    try {
      if (data.includes('number=')) {
        const match = data.match(/number=([^&]+)/);
        if (match && match[1]) {
          certNumber = decodeURIComponent(match[1]);
        }
      } else if (data.includes('/verify/')) {
        const parts = data.split('/verify/');
        if (parts[1]) {
          certNumber = decodeURIComponent(parts[1].split('?')[0]);
        }
      }
    } catch {
      // Use raw text fallback
    }

    if (route?.params?.onScan) {
      route.params.onScan(certNumber);
      navigation.goBack();
    } else {
      navigation.navigate('Certificates', {
        initialTab: 'verify',
        scannedNumber: certNumber,
      });
    }
  };

  if (!permission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Checking camera permission…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={64} color={colors.muted} />
        <Text style={styles.permissionTitle}>Camera Permission Required</Text>
        <Text style={styles.permissionDescription}>
          BizNexa needs camera access to scan QR codes on certificates for instant verification.
        </Text>
        <Button
          title="Grant Permission"
          onPress={requestPermission}
          variant="primary"
          style={{ marginTop: spacing.lg }}
        />
        <Button
          title="Cancel"
          onPress={() => navigation.goBack()}
          variant="ghost"
          style={{ marginTop: spacing.sm }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Top Header Overlay */}
      <View style={styles.topOverlay}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={24} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan Certificate QR</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Viewfinder Target */}
      <View style={styles.targetContainer}>
        <View style={styles.targetFrame}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>
        <Text style={styles.instructionText}>
          Align the certificate QR code within the frame to verify
        </Text>
      </View>

      {/* Rescan Button if scanned */}
      {scanned && (
        <View style={styles.bottomOverlay}>
          <Button
            title="Scan Again"
            onPress={() => setScanned(false)}
            variant="accent"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.night,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.night,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  permissionDescription: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  permissionText: {
    fontSize: 14,
    color: colors.muted,
  },
  topOverlay: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    zIndex: 10,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
  },
  targetContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetFrame: {
    width: 260,
    height: 260,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: colors.marigold,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: radius.sm,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: radius.sm,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: radius.sm,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: radius.sm,
  },
  instructionText: {
    color: colors.white,
    fontSize: 13,
    marginTop: spacing.xl,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 40,
    left: spacing.xl,
    right: spacing.xl,
  },
});
