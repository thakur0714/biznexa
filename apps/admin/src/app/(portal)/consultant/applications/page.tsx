import type { Metadata } from 'next';
import { ConsultantPortalView } from '../consultant-portal-view';
export const metadata: Metadata = { title: 'Assigned applications' };
export default function Page() { return <ConsultantPortalView section="applications" />; }
