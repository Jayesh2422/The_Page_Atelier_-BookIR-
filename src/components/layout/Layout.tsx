import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function Layout() {
  const { pathname } = useLocation();
  // Start each page at the top (query-string changes keep the scroll position).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <SiteHeader />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

export function PageContainer({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
