import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/authContext';
import { useCart } from '../hooks/useCart';
import { CartDrawer } from './CartDrawer';

export function Layout() {
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, isAdmin, logout } = useAuth();
  const { data: cart } = useCart();
  const location = useLocation();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `link-slide text-[0.8125rem] uppercase tracking-[0.1em] transition-colors ${
      isActive ? 'text-rust' : 'text-ink-soft hover:text-ink'
    }`;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Keyboard users land here first; it is visually hidden until focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-ink focus:bg-paper focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-paper-edge bg-paper/92 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1240px] items-center gap-6 px-5 py-4 sm:px-8">
          <Link to="/" className="shrink-0">
            <span className="font-display text-[1.375rem] font-semibold tracking-tight text-ink">
              Meridian
            </span>
            <span className="ml-1.5 font-display text-[1.375rem] text-rust">&amp;</span>
            <span className="ml-1.5 font-display text-[1.375rem] font-semibold tracking-tight text-ink">
              Co.
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-7 md:flex">
            <NavLink to="/" end className={navClass}>
              Shop
            </NavLink>
            {user && (
              <NavLink to="/account/orders" className={navClass}>
                Orders
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin" className={navClass}>
                Admin
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-4 md:ml-0">
            {user ? (
              <div className="hidden items-center gap-3 sm:flex">
                <span className="text-xs text-ink-faint">{user.name}</span>
                <span className="h-3 w-px bg-paper-edge" aria-hidden="true" />
                <button
                  onClick={() => void logout()}
                  className="link-slide text-[0.8125rem] uppercase tracking-[0.1em] text-ink-soft transition-colors hover:text-ink"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                state={{ from: location.pathname }}
                className="link-slide hidden text-[0.8125rem] uppercase tracking-[0.1em] text-ink-soft transition-colors hover:text-ink sm:block"
              >
                Sign in
              </Link>
            )}

            <button
              onClick={() => setCartOpen(true)}
              className="group relative flex items-center gap-2 border border-ink px-4 py-2 text-[0.8125rem] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-ink hover:text-paper"
              aria-label={`Open basket, ${cart?.itemCount ?? 0} items`}
            >
              Basket
              <span className="nums border-l border-current/30 pl-2">{cart?.itemCount ?? 0}</span>
            </button>

            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="border border-paper-edge px-3 py-2 text-xs uppercase tracking-[0.1em] text-ink md:hidden"
              aria-expanded={menuOpen}
            >
              Menu
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="fade-in border-t border-paper-edge bg-paper px-5 py-4 md:hidden">
            <nav className="flex flex-col gap-3.5">
              <NavLink to="/" end className={navClass} onClick={() => setMenuOpen(false)}>
                Shop
              </NavLink>
              {user && (
                <NavLink
                  to="/account/orders"
                  className={navClass}
                  onClick={() => setMenuOpen(false)}
                >
                  Orders
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/admin" className={navClass} onClick={() => setMenuOpen(false)}>
                  Admin
                </NavLink>
              )}
              {user ? (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void logout();
                  }}
                  className="text-left text-[0.8125rem] uppercase tracking-[0.1em] text-ink-soft"
                >
                  Sign out ({user.name})
                </button>
              ) : (
                <NavLink to="/login" className={navClass} onClick={() => setMenuOpen(false)}>
                  Sign in
                </NavLink>
              )}
            </nav>
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet context={{ openCart: () => setCartOpen(true) }} />
      </main>

      <footer className="mt-20 border-t border-paper-edge">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-5 py-9 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="font-display text-sm text-ink-soft">
            Meridian &amp; Co. — well-made things, sent by post.
          </p>
          <p className="label-xs">Demo storefront · Bank transfer checkout · Built for review</p>
        </div>
      </footer>

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
}
