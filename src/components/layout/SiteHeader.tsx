import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';

const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/explore', label: 'Explore', end: false },
  { to: '/evaluation', label: 'Search Evaluation', end: false },
];

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'rounded-full px-4 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-sage-soft text-olive' : 'text-ink hover:bg-white hover:text-olive',
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [lastPath, setLastPath] = useState(location.pathname);
  // Close the mobile menu after navigation.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-linen/80 bg-cream/90 backdrop-blur-sm">
      <a href="#main" className="sr-only rounded-md bg-white px-3 py-2 text-sm text-olive focus:not-sr-only focus:absolute focus:top-3 focus:left-3">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={navClass}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-full text-olive hover:bg-white md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-linen bg-cream px-4 pb-4 md:hidden">
          <ul className="flex flex-col gap-1 pt-3">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={(s) => cn(navClass(s), 'block py-3')}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
