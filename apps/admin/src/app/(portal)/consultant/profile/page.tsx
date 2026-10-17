import type { Metadata } from 'next';
import { ConsultantProfileEditor } from './profile-editor';

export const metadata: Metadata = { title: 'My consultant profile' };

export default function Page() {
  return <ConsultantProfileEditor />;
}
