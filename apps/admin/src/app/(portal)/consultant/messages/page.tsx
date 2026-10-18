import type { Metadata } from 'next';
import { ConsultantPortalView } from '../consultant-portal-view';
export const metadata: Metadata = { title: 'Messages' };
export default function Page() { return <ConsultantPortalView section="messages" />; }
