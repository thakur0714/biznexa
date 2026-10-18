import type { Metadata } from 'next';
import { CmsView } from './view';
export const metadata: Metadata = { title: 'Content & blog' };
export default function CmsPage() { return <CmsView />; }
