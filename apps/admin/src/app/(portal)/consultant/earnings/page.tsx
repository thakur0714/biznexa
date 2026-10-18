import type { Metadata } from 'next';
import { ConsultantPortalView } from '../consultant-portal-view';
export const metadata: Metadata = { title: 'Earnings' };
export default function Page() { return <ConsultantPortalView section="earnings" />; }
