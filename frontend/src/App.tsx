import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Briefcase, History, Coins, Sparkles, Repeat2, Database, LogOut, Menu, X, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./lib/api";
import { useStore } from "./stores/useStore";
import { cn } from "./lib/utils";
import Logo from "./components/Logo";
import { useTheme } from "./hooks/useTheme";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Holdings from "./pages/Holdings";
import Transactions from "./pages/Transactions";
import Roundtrips from "./pages/Roundtrips";
import Dividends from "./pages/Dividends";
import Advice from "./pages/Advice";
import AddTransaction from "./pages/AddTransaction";
import { RequireAuth } from "./components/RequireAuth";
import { ErrorBoundary } from "./components/ErrorBoundary";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/holdings", label: "Holdings", icon: Briefcase },
  { to: "/transactions", label: "Transactions", icon: History },
  { to: "/roundtrips", label: "Roundtrips", icon: Repeat2 },
  { to: "/dividends", label: "Dividends", icon: Coins },
  { to: "/advice", label: "Advice", icon: Sparkles },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const { theme, toggleTheme } = useTheme();
  const [cacheRefreshing, setCacheRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function onCacheRefresh() {
    setCacheRefreshing(true);
    try {
      const r = await api.cacheRefresh();
      qc.invalidateQueries();
      console.log(`Cache refreshed: ${r.prices_updated} prices, ${r.dividends_refreshed} dividend symbols`);
    } catch (e) {
      console.error(e);
      alert("Failed to refresh: " + (e as Error).message);
    } finally {
      setCacheRefreshing(false);
    }
  }

  async function onLogout() {
    setLoggingOut(true);
    try {
      await api.authLogout();
    } catch {}
    setUser(null);
    setLoggingOut(false);
    navigate("/login", { replace: true });
  }

  function handleNav() {
    onNavigate?.();
  }

  return (
    <aside className="w-60 border-r border-line bg-bg-soft p-4 flex flex-col shrink-0 h-full">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/" onClick={handleNav}>
          <Logo size="sm" />
        </Link>
        <button
          onClick={toggleTheme}
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          aria-label="Toggle theme"
          className="p-1.5 rounded-md text-ink-faint hover:text-ink hover:bg-bg-card border border-line/60"
        >
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </div>
      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={handleNav}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-bg-card",
                isActive && "bg-bg-card text-ink"
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="flex flex-col gap-2 pt-4 border-t border-line text-xs">
        <button
          onClick={onCacheRefresh}
          disabled={cacheRefreshing}
          className="flex items-center gap-2 rounded-md border border-line px-3 py-2 hover:bg-bg-card disabled:opacity-50"
          title="Re-fetch prices, dividends, and rebuild dashboard cache"
        >
          <Database size={14} className={cacheRefreshing ? "animate-spin" : ""} />
          {cacheRefreshing ? "Refreshing…" : "Refresh"}
        </button>
        {user && (
          <div className="mt-2 pt-2 border-t border-line">
            <div className="flex items-center gap-2 px-1 py-1">
              {user.picture ? (
                <img src={user.picture} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-accent text-bg flex items-center justify-center text-[11px] font-semibold">
                  {(user.name || user.email || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-ink truncate text-[11px] font-medium">{user.name || user.email}</div>
                {user.name && <div className="text-ink-faint truncate text-xs">{user.email}</div>}
              </div>
            </div>
            <button
              onClick={onLogout}
              disabled={loggingOut}
              className="w-full mt-1 flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 hover:bg-bg-card disabled:opacity-50"
            >
              <LogOut size={12} />
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function AuthedLayout() {
  const loc = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="flex h-full">
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 h-12 px-3 flex items-center gap-2 border-b border-line bg-bg-soft">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1.5 hover:bg-bg-card"
        >
          <Menu size={18} />
        </button>
        <Link to="/">
          <Logo size="sm" showText={false} />
        </Link>
      </div>

      {/* Desktop sidebar — always visible at md+ */}
      <div className="hidden md:flex shrink-0">
        <Sidebar />
      </div>

      {/* Mobile drawer — slides in from the left */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute top-0 left-0 bottom-0 w-64 bg-bg-soft border-r border-line shadow-xl flex flex-col">
            <div className="flex items-center justify-end px-3 pt-2">
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1.5 hover:bg-bg-card"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-auto w-full">
        <div className="md:hidden h-12" aria-hidden="true" />
        <div key={loc.pathname} className="p-3 sm:p-6 max-w-[1400px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function PublicLayout() {
  return (
    <div className="flex h-full">
      <main className="flex-1 overflow-auto">
        <div className="max-w-[1400px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/login" element={<Login />} />
        </Route>
        <Route element={<RequireAuth><AuthedLayout /></RequireAuth>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/transactions/add" element={<AddTransaction />} />
          <Route path="/roundtrips" element={<Roundtrips />} />
          <Route path="/dividends" element={<Dividends />} />
          <Route path="/advice" element={<Advice />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
