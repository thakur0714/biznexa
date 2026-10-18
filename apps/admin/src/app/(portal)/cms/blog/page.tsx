import type { Metadata } from 'next';
import { BlogAdminView } from './view';
export const metadata: Metadata = { title: 'Blog management' };
export default function BlogPage() { return <BlogAdminView />; }
