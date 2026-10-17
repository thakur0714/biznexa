import type { Metadata } from 'next';
import { ConsultantApplicationForm } from './consultant-application-form';

export const metadata: Metadata = {
  title: 'Apply as a consultant',
  description: 'Apply to join the BizNexa consultant network.',
  robots: { index: false, follow: false },
};

export default function ConsultantApplicationPage() {
  return <ConsultantApplicationForm />;
}
