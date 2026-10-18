import * as LocalAuthentication from 'expo-local-authentication';

export interface BiometricStatus {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
}

export async function checkBiometrics(): Promise<BiometricStatus> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return {
      hasHardware,
      isEnrolled,
      supportedTypes,
    };
  } catch {
    return {
      hasHardware: false,
      isEnrolled: false,
      supportedTypes: [],
    };
  }
}

export async function promptBiometricAuth(promptMessage = 'Unlock BizNexa'): Promise<boolean> {
  try {
    const status = await checkBiometrics();
    if (!status.hasHardware || !status.isEnrolled) {
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use password',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    return result.success;
  } catch {
    return false;
  }
}
