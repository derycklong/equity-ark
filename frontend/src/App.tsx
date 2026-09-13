import { useEffect, useState, type ElementType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme as useMuiTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import AccountBalanceWalletOutlined from "@mui/icons-material/AccountBalanceWalletOutlined";
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import CompareArrowsOutlined from "@mui/icons-material/CompareArrowsOutlined";
import PaidOutlined from "@mui/icons-material/PaidOutlined";
import AutoAwesomeOutlined from "@mui/icons-material/AutoAwesomeOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import LogoutOutlined from "@mui/icons-material/LogoutOutlined";
import MenuRounded from "@mui/icons-material/MenuRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import AdminPanelSettingsOutlined from "@mui/icons-material/AdminPanelSettingsOutlined";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import { useStore } from "./stores/useStore";
import { timeAgo } from "./lib/utils";
import { useDashboard } from "./hooks/usePortfolio";
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
import Admin from "./pages/Admin";
import { RequireAuth } from "./components/RequireAuth";
import { ErrorBoundary } from "./components/ErrorBoundary";

const DRAWER_WIDTH = 256;

const navItems: { to: string; label: string; icon: ElementType; end?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: DashboardOutlined, end: true },
  { to: "/holdings", label: "Holdings", icon: AccountBalanceWalletOutlined },
  { to: "/transactions", label: "Transactions", icon: ReceiptLongOutlined },
  { to: "/roundtrips", label: "Roundtrips", icon: CompareArrowsOutlined },
  { to: "/dividends", label: "Dividends", icon: PaidOutlined },
  { to: "/advice", label: "Advice", icon: AutoAwesomeOutlined },
];

type Notice = { message: string; severity: "success" | "error" | "info" };

function SidebarContent({
  onNavigate,
  onNotify,
}: {
  onNavigate?: () => void;
  onNotify: (notice: Notice) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const { theme, toggleTheme } = useTheme();
  const muiTheme = useMuiTheme();
  const location = useLocation();
  const [cacheRefreshing, setCacheRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const dashboard = useDashboard();

  const items: typeof navItems = user?.is_admin
    ? [...navItems, { to: "/admin", label: "Admin", icon: AdminPanelSettingsOutlined }]
    : navItems;

  async function onCacheRefresh() {
    setCacheRefreshing(true);
    try {
      const result = await api.cacheRefresh();
      qc.invalidateQueries();
      onNotify({
        severity: "success",
        message: `Refreshed ${result.prices_updated} prices and ${result.dividends_refreshed} dividend symbols`,
      });
    } catch (error) {
      onNotify({ severity: "error", message: `Refresh failed: ${(error as Error).message}` });
    } finally {
      setCacheRefreshing(false);
    }
  }

  async function onLogout() {
    setLoggingOut(true);
    try {
      await api.authLogout();
    } catch {
      // The local session is still cleared if the server is unavailable.
    }
    setUser(null);
    setLoggingOut(false);
    navigate("/login", { replace: true });
  }

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", p: 2 }}>
      <Stack direction="row" sx={{ mb: 2.5, alignItems: "center", justifyContent: "space-between" }}>
        <Link to="/" onClick={onNavigate} style={{ color: "inherit", textDecoration: "none" }}>
          <Logo size="sm" />
        </Link>
        <Tooltip title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}>
          <IconButton
            size="small"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            sx={{ border: 1, borderColor: "divider", color: "text.secondary" }}
          >
            {theme === "light" ? <DarkModeOutlined fontSize="small" /> : <LightModeOutlined fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>

      <List disablePadding sx={{ display: "flex", flexDirection: "column", gap: 0.25, flex: 1, alignItems: "stretch" }}>
        {items.map(({ to, label, icon: Icon, end }) => (
          <ListItemButton
            key={to}
            component={NavLink}
            to={to}
            end={end}
            onClick={onNavigate}
            className={(end ? location.pathname === to : location.pathname.startsWith(to)) ? "nav-item-active" : undefined}
            aria-current={(end ? location.pathname === to : location.pathname.startsWith(to)) ? "page" : undefined}
            sx={{
              flex: "0 0 36px",
              height: 36,
              minHeight: 36,
              maxHeight: 36,
              borderRadius: 1.5,
              px: 1.25,
              color: "text.secondary",
              "&:hover": { bgcolor: alpha(muiTheme.palette.primary.main, 0.08), color: "text.primary" },
              "&.nav-item-active": {
                bgcolor: alpha(muiTheme.palette.primary.main, muiTheme.palette.mode === "dark" ? 0.16 : 0.1),
                color: "primary.main",
                "& .MuiListItemIcon-root": { color: "primary.main" },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 32, color: "inherit" }}>
              <Icon sx={{ fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText primary={label} sx={{ "& .MuiListItemText-primary": { fontSize: "0.75rem", fontWeight: 650 } }} />
          </ListItemButton>
        ))}
      </List>

      <Divider sx={{ my: 1.5 }} />

      <Stack spacing={1}>
        <Button
          fullWidth
          size="small"
          variant="outlined"
          color="inherit"
          onClick={onCacheRefresh}
          disabled={cacheRefreshing}
          startIcon={<RefreshRounded className={cacheRefreshing ? "spin-icon" : undefined} />}
          sx={{ justifyContent: "flex-start", color: "text.secondary", borderColor: "divider", minHeight: 30, py: 0.25, px: 1, fontSize: "0.72rem", "& .MuiButton-startIcon": { mr: 0.75 }, "& .MuiSvgIcon-root": { fontSize: 16 } }}
        >
          {cacheRefreshing ? "Refreshing…" : "Refresh market data"}
        </Button>
        {dashboard.data?.last_refreshed_at && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
            Updated {timeAgo(dashboard.data.last_refreshed_at)}
          </Typography>
        )}
      </Stack>

      {user && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1.25} sx={{ px: 0.5, minWidth: 0, alignItems: "center" }}>
            <Avatar src={user.picture || undefined} sx={{ width: 32, height: 32, bgcolor: "primary.main", color: "primary.contrastText", fontSize: 13 }}>
              {(user.name || user.email || "?").slice(0, 1).toUpperCase()}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 650 }}>{user.name || user.email}</Typography>
              {user.name && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{user.email}</Typography>}
            </Box>
          </Stack>
          <Button
            fullWidth
            size="small"
            variant="text"
            color="inherit"
            onClick={onLogout}
            disabled={loggingOut}
            startIcon={<LogoutOutlined fontSize="small" />}
            sx={{ mt: 0.75, color: "text.secondary", minHeight: 30, py: 0.25, fontSize: "0.72rem", "& .MuiButton-startIcon": { mr: 0.75 }, "& .MuiSvgIcon-root": { fontSize: 16 } }}
          >
            {loggingOut ? "Signing out…" : "Sign out"}
          </Button>
        </>
      )}
    </Box>
  );
}

function AuthedLayout() {
  const loc = useLocation();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("md"));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pageLabel = loc.pathname === "/" ? "Overview" : loc.pathname.startsWith("/admin/refresh") ? "Refresh data" : navItems.find((item) => loc.pathname.startsWith(item.to) && item.to !== "/")?.label || (loc.pathname.startsWith("/admin") ? "Admin" : "Portfolio");

  useEffect(() => {
    setDrawerOpen(false);
  }, [loc.pathname]);

  const sidebar = <SidebarContent onNavigate={() => setDrawerOpen(false)} onNotify={setNotice} />;

  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
      {isMobile ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" } }}
        >
          <Stack direction="row" sx={{ px: 1, pt: 1, justifyContent: "flex-end" }}>
            <IconButton aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
              <CloseRounded />
            </IconButton>
          </Stack>
          {sidebar}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          open
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", position: "relative" },
          }}
        >
          {sidebar}
        </Drawer>
      )}

      <Box component="main" sx={{ flex: 1, minWidth: 0, height: "100%", overflow: "auto", bgcolor: "background.default" }}>
        {isMobile && (
          <AppBar position="sticky" color="inherit" sx={{ display: { md: "none" }, zIndex: (theme) => theme.zIndex.drawer + 1 }}>
            <Toolbar variant="dense" sx={{ minHeight: 60, px: { xs: 1.25, sm: 1.5 }, gap: 0.75 }}>
              <IconButton aria-label="Open menu" onClick={() => setDrawerOpen(true)} edge="start">
                <MenuRounded />
              </IconButton>
              <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
                <Logo size="sm" showText={false} />
              </Link>
              <Typography variant="subtitle2" sx={{ ml: 0.25, fontWeight: 700 }}>{pageLabel}</Typography>
              <Box sx={{ flex: 1 }} />
            </Toolbar>
          </AppBar>
        )}
        <Box key={loc.pathname} sx={{ width: "100%", maxWidth: 1400, mx: "auto", p: { xs: 1.25, sm: 3 }, pb: { xs: 4, sm: 3 } }}>
          <Outlet />
        </Box>
      </Box>

      <Snackbar open={!!notice} autoHideDuration={5000} onClose={() => setNotice(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <Alert onClose={() => setNotice(null)} severity={notice?.severity || "info"} variant="filled" sx={{ width: "100%" }}>
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function PublicLayout() {
  return (
    <Box sx={{ height: "100%", overflow: "auto", bgcolor: "background.default" }}>
      <Box sx={{ width: "100%", maxWidth: 1400, minHeight: "100%", mx: "auto" }}>
        <Outlet />
      </Box>
    </Box>
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
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/refresh" element={<Admin />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
