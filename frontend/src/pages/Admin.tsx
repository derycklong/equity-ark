import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import { api, type AdminUser } from "../lib/api";
import { fmtDate } from "../lib/utils";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";
import PageHeader from "../components/ui/PageHeader";
import MetricCard from "../components/ui/MetricCard";

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return "—";
  return fmtDate(new Date(ts * 1000).toISOString().slice(0, 10));
}

type SortKey = "email" | "last_login_at" | "created_at";

export default function Admin() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.adminUsers(),
    staleTime: 30_000,
  });
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_login_at");
  const [sortDesc, setSortDesc] = useState(true);

  const users = data?.users ?? [];
  const adminEmails: string[] = data?.admin_emails ?? [];
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((current) => !current);
    else { setSortKey(key); setSortDesc(true); }
  };

  if (isLoading) return <LoadingScreen />;
  if (error) {
    const message = (error as Error).message || "";
    const forbidden = message.includes("403") || message.toLowerCase().includes("admin");
    return <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}><PageHeader title="Admin" icon={<AdminPanelSettingsOutlined />} /><Alert severity="error" variant="outlined">{forbidden ? "You don't have admin access. Set ADMIN_EMAILS in backend/data/.env and restart the backend." : `Failed to load users: ${message}`}</Alert></Box>;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <PageHeader
        title="Admin"
        icon={<AdminPanelSettingsOutlined />}
        subtitle={`${users.length} user${users.length !== 1 ? "s" : ""}${adminEmails.length ? ` · ${adminEmails.length} configured admin${adminEmails.length !== 1 ? "s" : ""}` : " · admin unset"}`}
        actions={<Stack direction="row" spacing={1} sx={{ alignItems: "center", width: { xs: "100%", sm: "auto" } }}><TextField size="small" label="Filter users" placeholder="Email or name" value={search} onChange={(event) => setSearch(event.target.value)} sx={{ minWidth: { xs: 0, sm: 230 }, flex: 1 }} /><IconButton onClick={() => refetch()} disabled={isFetching} title="Refresh users" sx={{ border: 1, borderColor: "divider" }}><RefreshRounded className={isFetching ? "spin-icon" : undefined} /></IconButton></Stack>}
      />

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
        <MetricCard label="Users" value={users.length} supporting="all registered accounts" tone="primary" icon={<PeopleOutlineRounded fontSize="small" />} />
        <MetricCard label="Admins" value={adminEmails.length} supporting="configured admin emails" tone="warning" icon={<AdminPanelSettingsOutlined fontSize="small" />} />
        <MetricCard label="Visible rows" value={filtered.length} supporting={search ? "matching current filter" : "current view"} />
      </Box>

      <Card variant="outlined" sx={{ overflow: "hidden" }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: { xs: 1.5, sm: 2 }, py: 1.25, bgcolor: "action.hover" }}>
          <PeopleOutlineRounded fontSize="small" color="primary" />
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>All users</Typography>
          {search && <Chip size="small" label={`${filtered.length} match${filtered.length === 1 ? "" : "es"}`} variant="outlined" />}
        </Stack>
        <MobileTable
          items={filtered}
          keyOf={(user) => user.id}
          empty={search ? `No users match "${search}".` : "No users have signed in yet."}
          renderCard={(user) => <UserCard user={user} isAdmin={adminEmails.includes(user.email.toLowerCase())} />}
          renderTable={() => (
            <TableContainer sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 700 }}>
                <TableHead><TableRow><TableCell>User</TableCell><TableCell><TableSortLabel active={sortKey === "email"} direction={sortKey === "email" ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort("email")}>Email</TableSortLabel></TableCell><TableCell align="right"><TableSortLabel active={sortKey === "last_login_at"} direction={sortKey === "last_login_at" ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort("last_login_at")}>Last login</TableSortLabel></TableCell><TableCell align="right"><TableSortLabel active={sortKey === "created_at"} direction={sortKey === "created_at" ? (sortDesc ? "desc" : "asc") : "asc"} onClick={() => handleSort("created_at")}>Joined</TableSortLabel></TableCell></TableRow></TableHead>
                <TableBody>{filtered.map((user) => { const isAdmin = adminEmails.includes(user.email.toLowerCase()); return <TableRow key={user.id} hover><TableCell><UserIdentity user={user} isAdmin={isAdmin} /></TableCell><TableCell sx={{ color: "text.secondary" }}>{user.email}</TableCell><TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtTs(user.last_login_at)}</TableCell><TableCell align="right" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtTs(user.created_at)}</TableCell></TableRow>; })}</TableBody>
              </Table>
            </TableContainer>
          )}
        />
      </Card>
    </Box>
  );
}

function UserIdentity({ user, isAdmin }: { user: AdminUser; isAdmin: boolean }) {
  return <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}><Avatar src={user.picture || undefined} sx={{ width: 32, height: 32, bgcolor: "primary.main", color: "primary.contrastText", fontSize: 13 }}>{(user.name || user.email).slice(0, 1).toUpperCase()}</Avatar><Box sx={{ minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>{user.name || user.email}</Typography>{isAdmin && <Chip size="small" icon={<AdminPanelSettingsOutlined />} label="admin" color="primary" variant="outlined" sx={{ mt: 0.25 }} />}</Box></Stack>;
}

function UserCard({ user, isAdmin }: { user: AdminUser; isAdmin: boolean }) {
  return <Card variant="outlined"><CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}><UserIdentity user={user} isAdmin={isAdmin} /><Stack direction="row" spacing={2} sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: "divider" }}><Box><Typography variant="caption" color="text.secondary">Last login</Typography><Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtTs(user.last_login_at)}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Joined</Typography><Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmtTs(user.created_at)}</Typography></Box></Stack></CardContent></Card>;
}
