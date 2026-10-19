type RazorpaySdk = typeof import('react-native-razorpay');

declare const require: (moduleName: 'react-native-razorpay') => RazorpaySdk;

/** Load only when a real gateway checkout is needed; this keeps mock checkout usable in Expo Go. */
export function loadRazorpayCheckout(): RazorpaySdk['default'] {
  return require('react-native-razorpay').default;
}
