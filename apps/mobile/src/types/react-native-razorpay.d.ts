declare module 'react-native-razorpay' {
  interface RazorpayCheckoutOptions {
    key: string;
    amount: number;
    currency: 'INR';
    name: string;
    order_id: string;
    description: string;
    prefill: { name: string | null; email: string | null; contact: string | null };
    method: { upi: boolean; card: boolean; netbanking: boolean; wallet: boolean; emi: boolean };
  }

  interface RazorpayCheckoutResult {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }

  const RazorpayCheckout: {
    open(options: RazorpayCheckoutOptions): Promise<RazorpayCheckoutResult>;
  };

  export default RazorpayCheckout;
}
