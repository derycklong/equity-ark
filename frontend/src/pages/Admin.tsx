import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";
import AdminPanelSettingsOutlined from "@mui/icons-material/AdminPanelSettingsOutlined";
import PeopleOutlineRounded from "@mui/icons-material/PeopleOutlineRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import { api, type AdminRefreshUser, type AdminUser } from "../lib/api";
import { fmtDate, timeAgo } from "../lib/utils";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";
import PageHeader from "../components/ui/PageHeader";
import MetricCard from "../components/ui/MetricCard";

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return "—";
  return fmtDate(new Date(ts * 1000).toISOString().slice(0, 10));
}

function statusLabel(status: AdminRefreshUser["refresh_status"]): string {
  if (status === "running") return "Refreshing";
  if (status === "queued") return "Queued";
  if (status === "success") return "Complete";
  if (status === "error") return "Failed";
  return "Not refreshed";
}

function statusColor(status: AdminRefreshUser["refresh_status"]): "default" | "success" | "error" | "warning" | "primary" {
  if (status === "running") return "primary";
  if (status === "queued") return "warning";
  if (status === "success") return "success";
  if (status === "error") return "error";
  return "default";
}

function UserIdentity({ user, isAdmin }: { user: AdminUser; isAdmin: boolean }) {
  return <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}><Avatar src={user.picture || undefined} sx={{ width: 32, height: 32, bgcolor: "primary.main", color: "primary.contrastText", fontSize: 13 }}>{(user.name || user.email).slice(0, 1).toUpperCase()}</Avatar><Box sx={{ minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>{user.name || user.email}</Typography>{user.name && user.name !== user.email && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{user.email}</Typography>}{isAdmin && <Chip size="small" icon={<AdminPanelSettingsOutlined />} label="admin" color="primary" variant="outlined" sx={{ mt: 0.25 }} />}</Box></Stack>;
}

function RefreshStatus({ user }: { user: AdminRefreshUser }) {
  return <Stack spacing={0.35} sx={{ alignItems: { xs: "flex-start", md: "flex-end" } }}><Chip size="small" label={statusLabel(user.refresh_status)} color={statusColor(user.refresh_status)} variant={user.refresh_status === "idle" ? "outlined" : "filled"} />{user.refresh_error && <Typography variant="caption" color="error.main" sx={{ maxWidth: 240 }} noWrap title={user.refresh_error}>{user.refresh_error}</Typography>}</Stack>;
}

function RefreshAction({ user, busy, onRefresh }: { user: AdminRefreshUser; busy: boolean; onRefresh: () => void }) {
  const running = user.refresh_status === "running" || user.refresh_status === "queued";
  return <Button size="small" variant="outlined" onClick={onRefresh} disabled={busy || running} startIcon={busy || running ? <CircularProgress size={14} /> : <RefreshRounded />} sx={{ whiteSpace: "nowrap" }}>{running ? statusLabel(user.refresh_status) : "Refresh"}</Button>;
}

function UserCard({ user, isAdmin, busy, onRefresh }: { user: AdminRefreshUser; isAdmin: boolean; busy: boolean; onRefresh: () => void }) {
  return <Card variant="outlined"><CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}><Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}><UserIdentity user={user} isAdmin={isAdmin} /><RefreshAction user={user} busy={busy} onRefresh={onRefresh} /></Stack><Stack direction="row" spacing={2} sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: "divider", flexWrap: "wrap", rowGap: 1 }}><Box><Typography variant="caption" color="text.secondary">Email</Typography><Typography variant="body2" noWrap>{user.email}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Last login</Typography><Typography variant="body2">{fmtTs(user.last_login_at)}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Last used</Typography><Typography variant="body2">{fmtTs(user.last_used_at)}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Last refreshed</Typography><Typography variant="body2">{timeAgo(user.last_refreshed_at)}</Typography></Box><RefreshStatus user={user} /></Stack></CardContent></Card>;
}

type SortKey = "email" | "last_login_at" | "last_used_at" | "created_at" | "last_refreshed_at";

export default function Admin() {
  const qc = useQueryClient();
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: () => api.adminUsers(), staleTime: 30_000 });
  const refreshQuery = useQuery({ queryKey: ["admin", "refresh"], queryFn: () => api.adminRefreshStatus(), refetchInterval: 4000 });
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_login_at");
  const [sortDesc, setSortDesc] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [busyClear, setBusyClear] = useState(false);
  const [notice, setNotice] = useState<{ severity: "success" | "error"; message: string } | null>(null);

  const baseUsers = usersQuery.data?.users ?? [];
  const refreshUsers = refreshQuery.data?.users ?? [];
  const users = useMemo<AdminRefreshUser[]>(() => {
    const refreshById = new Map(refreshUsers.map((user) => [user.id, user]));
    return baseUsers.map((user) => ({ ...user, ...(refreshById.get(user.id) || {}), last_refreshed_at: refreshById.get(user.id)?.last_refreshed_at ?? null, refresh_status: refreshById.get(user.id)?.refresh_status ?? "idle" }));
  }, [baseUsers, refreshUsers]);
  const adminEmails: string[] = usersQuery.data?.admin_emails ?? [];
  const filtered = useMemo(() => {
    const rows = [...users].filter((user) => {
      if (!search) return true;
      const query = search.toLowerCase();
      return user.email.toLowerCase().includes(query) || (user.name || "").toLowerCase().includes(query);
    });
    rows.sort((a, b) => {
      const av = sortKey === "email" ? a.email : a[sortKey] ?? 0;
      const bv = sortKey === "email" ? b.email : b[sortKey] ?? 0;
      if (av === bv) return 0;
      return sortDesc ? (av < bv ? 1 : -1) : (av < bv ? -1 : 1);
    });
    return rows;
  }, [users, search, sortKey, sortDesc]);
  const refreshing = users.filter((user) => user.refresh_status === "running" || user.refresh_status === "queued").length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((current) => !current);
    else { setSortKey(key); setSortDesc(true); }
  };

  async function refreshUser(userId: string) {
    setBusyUser(userId);
    setNotice(null);
    try {
      await api.adminRefreshUser(userId);
      await qc.invalidateQueries({ queryKey: ["admin", "refresh"] });
      setNotice({ severity: "success", message: "Refresh started. Status will update automatically." });
    } catch (error) {
      setNotice({ severity: "error", message: `Refresh failed: ${(error as Error).message}` });
    } finally {
      setBusyUser(null);
    }
  }

  async function refreshAll() {
    setBusyAll(true);
    setNotice(null);
    try {
      const result = await api.adminRefreshAll();
      await qc.invalidateQueries({ queryKey: ["admin", "refresh"] });
      setNotice({ severity: "success", message: `Started refresh for ${result.started} of ${result.total} users.` });
    } catch (error) {
      setNotice({ severity: "error", message: `Refresh failed: ${(error as Error).message}` });
    } finally {
      setBusyAll(false);
    }
  }

  async function clearAndRefreshAll() {
    setBusyClear(true);
    setNotice(null);
    try {
      const result = await api.adminClearAndRefreshAll();
      await qc.invalidateQueries({ queryKey: ["admin", "refresh"] });
      setNotice({ severity: "success", message: `Cleared ${result.cleared.price_cache} price caches and started a full refresh for ${result.started} of ${result.total} users.` });
    } catch (error) {
      setNotice({ severity: "error", message: `Full refresh failed: ${(error as Error).message}` });
    } finally {
      setBusyClear(false);
    }
  }

  if (usersQuery.isLoading || refreshQuery.isLoading) return <LoadingScreen />;
  if (usersQuery.error || refreshQuery.error) {
    const error = usersQuery.error || refreshQuery.error;
    const message = (error as Error).message || "";
    const forbidden = message.includes("403") || message.toLowerCase().includes("admin");
    return <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}><PageHeader title="Admin" icon={<AdminPanelSettingsOutlined />} /><Alert severity="error" variant="outlined">{forbidden ? "You don't have admin access. Set ADMIN_EMAILS in backend/data/.env and restart the backend." : `Failed to load admin data: ${message}`}</Alert></Box>;
  }

  return <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <PageHeader title="Admin" icon={<AdminPanelSettingsOutlined />} subtitle={`${users.length} user${users.length !== 1 ? "s" : ""}${adminEmails.length ? ` · ${adminEmails.length} configured admin${adminEmails.length !== 1 ? "s" : ""}` : " · admin unset"}`} actions={<Stack direction="row" spacing={1} sx={{ alignItems: "center", width: { xs: "100%", sm: "auto" }, flexWrap: "wrap" }}><Button variant="outlined" color="warning" size="small" onClick={clearAndRefreshAll} disabled={busyClear || busyAll || refreshing > 0} startIcon={busyClear ? <CircularProgress size={15} /> : <RefreshRounded />}>Clear cache & full refresh</Button><Button variant="contained" size="small" onClick={refreshAll} disabled={busyAll || busyClear || refreshing > 0} startIcon={busyAll ? <CircularProgress size={15} color="inherit" /> : <RefreshRounded />}>Refresh all users</Button></Stack>} />
    {notice && <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.message}</Alert>}
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%", flexWrap: "wrap" }}><TextField size="small" label="Filter users" placeholder="Email or name" value={search} onChange={(event) => setSearch(event.target.value)} sx={{ minWidth: { xs: 0, sm: 280 }, flex: { xs: "1 1 100%", sm: "1 1 auto" } }} /><IconButton onClick={() => { usersQuery.refetch(); refreshQuery.refetch(); }} disabled={usersQuery.isFetching || refreshQuery.isFetching} title="Refresh admin data" sx={{ border: 1, borderColor: "divider" }}><RefreshRounded className={usersQuery.isFetching || refreshQuery.isFetching ? "spin-icon" : undefined} /></IconButton></Stack>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: 1.5 }}><MetricCard label="Users" value={users.length} supporting="all registered accounts" tone="primary" icon={<PeopleOutlineRounded fontSize="small" />} /><MetricCard label="Admins" value={adminEmails.length} supporting="configured admin emails" tone="warning" icon={<AdminPanelSettingsOutlined fontSize="small" />} /><MetricCard label="Refreshing" value={refreshing} supporting="currently in progress" tone={refreshing ? "warning" : "default"} icon={<RefreshRounded fontSize="small" />} /><MetricCard label="Visible rows" value={filtered.length} supporting={search ? "matching current filter" : "current view"} /></Box>
    <Card variant="outlined" sx={{ overflow: "hidden", width: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: { xs: 1.5, sm: 2 }, py: 1.25, bgcolor: "action.hover" }}><PeopleOutlineRounded fontSize="small" color="primary" /><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Users and refresh status</Typography>{search && <Chip size="small" label={`${filtered.length} match${filtered.length === 1 ? "" : "es"}`} variant="outlined" />}</Stack>
      <MobileTable items={filtered} keyOf={(user) => user.id} empty={search ? `No users match "${search}".` : "No users have signed in yet."} renderCard={(user) => <UserCard user={user} isAdmin={adminEmails.includes(user.email.toLowerCase())} busy={busyUser === user.id} onRefresh={() => refreshUser(user.id)} />} renderTable={() => <TableContainer sx={{ width: "100%", overflowX: "auto" }}><Table size="small" sx={{ width: "100%", tableLayout: "fixed", minWidth: 980 }}><TableHead><TableRow><TableCell sx={{ width: "32%" }}><TableSortLabel active={sortKey === "email"} direction={sortKey === "email" ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort("email")}>User</TableSortLabel></TableCell><TableCell sx={{ width: "11%" }} align="right"><TableSortLabel active={sortKey === "last_login_at"} direction={sortKey === "last_login_at" ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort("last_login_at")}>Last login</TableSortLabel></TableCell><TableCell sx={{ width: "11%" }} align="right"><TableSortLabel active={sortKey === "last_used_at"} direction={sortKey === "last_used_at" ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort("last_used_at")}>Last used</TableSortLabel></TableCell><TableCell sx={{ width: "11%" }} align="right"><TableSortLabel active={sortKey === "created_at"} direction={sortKey === "created_at" ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort("created_at")}>Joined</TableSortLabel></TableCell><TableCell sx={{ width: "13%" }} align="right"><TableSortLabel active={sortKey === "last_refreshed_at"} direction={sortKey === "last_refreshed_at" ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort("last_refreshed_at")}>Last refreshed</TableSortLabel></TableCell><TableCell sx={{ width: "13%" }} align="right">Refresh status</TableCell><TableCell sx={{ width: "9%" }} align="right">Action</TableCell></TableRow></TableHead><TableBody>{filtered.map((user) => { const isAdmin = adminEmails.includes(user.email.toLowerCase()); return <TableRow key={user.id} hover><TableCell><UserIdentity user={user} isAdmin={isAdmin} /></TableCell><TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtTs(user.last_login_at)}</TableCell><TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtTs(user.last_used_at)}</TableCell><TableCell align="right" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtTs(user.created_at)}</TableCell><TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{timeAgo(user.last_refreshed_at)}</TableCell><TableCell align="right"><RefreshStatus user={user} /></TableCell><TableCell align="right"><RefreshAction user={user} busy={busyUser === user.id} onRefresh={() => refreshUser(user.id)} /></TableCell></TableRow>; })}</TableBody></Table></TableContainer>} />
    </Card>
  </Box>;
}
