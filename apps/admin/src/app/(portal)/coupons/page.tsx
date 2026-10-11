import type { Metadata } from 'next';
import { CouponsView } from './coupons-view';

export const metadata: Metadata = { title: 'Coupons' };

export default function CouponsPage() {
  return <CouponsView />;
}
