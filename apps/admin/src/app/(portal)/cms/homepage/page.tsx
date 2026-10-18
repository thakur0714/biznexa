import type { Metadata } from 'next';
import { HomepageCmsView } from '../homepage-view';
export const metadata: Metadata = { title: 'Homepage content' };
export default function Page() { return <HomepageCmsView />; }
