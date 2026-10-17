import type { Metadata } from 'next';
import { ConsultantAvailabilityEditor } from './availability-editor';

export const metadata: Metadata = { title: 'Consultant availability' };

export default function Page() {
  return <ConsultantAvailabilityEditor />;
}
