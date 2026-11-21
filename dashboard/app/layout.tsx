import './styles.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ReleaseGuard · Incidents',
  description: 'Review CI failures, captured evidence, and engineering handoffs.',
  icons: '/mark.svg',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
