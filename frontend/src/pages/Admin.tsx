import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Search, Shield, RefreshCw } from "lucide-react";
import { api, AdminUser } from "../lib/api";
import { fmtDate } from "../lib/utils";
import { LoadingScreen } from "../components/LoadingScreen";
import MobileTable from "../components/MobileTable";

// Backend returns unix timestamps (seconds). `fmtDate` expects a string —
// normalise to an ISO date string so the existing formatter works.
function fmtTs(ts: number | null | undefined): string {
  if (!ts) return "—";
  return fmtDate(new Date(ts * 1000).toISOString().slice(0, 10));
}

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
  const filtered = useMemo(() => {
    let rows = [...users];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.name || "").toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => {
      const av = sortKey === "email" ? a.email : a[sortKey] ?? 0;
      const bv = sortKey === "email" ? b.email : b[sortKey] ?? 0;
      if (av === bv) return 0;
      if (sortDesc) return av < bv ? 1 : -1;
      return av < bv ? -1 : 1;
    });
    return rows;
  }, [users, search, sortKey, sortDesc]);

  if (isLoading) return <LoadingScreen />;
  if (error) {
    const msg = (error as Error).message || "";
    const is403 = msg.includes("403") || msg.toLowerCase().includes("admin");
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Shield size={18} className="text-accent" />
          Admin
        </h1>
        <div className="rounded-lg border border-bad/30 bg-bad/5 p-4 text-sm text-bad">
          {is403
            ? "You don't have admin access. Set ADMIN_EMAIL in backend/data/.env and restart the backend to grant your account admin."
            : `Failed to load users: ${msg}`}
        </div>
      </div>
    );
  }

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDesc((d) => !d);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };
  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null;
    return <span className="text-ink-faint ml-1">{sortDesc ? "↓" : "↑"}</span>;
  };

  const adminEmails: string[] = data?.admin_emails ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Shield size={18} className="text-accent" />
            Admin
          </h1>
          <p className="text-ink-dim text-sm mt-1">
            {users.length} user{users.length !== 1 ? "s" : ""}
            {adminEmails.length > 0 && (
              <>
                {" · "}
                {adminEmails.length === 1 ? "admin " : "admins "}
                {adminEmails.map((e, i) => (
                  <span key={e}>
                    {i > 0 && ", "}
                    <span className="font-mono">{e}</span>
                  </span>
                ))}
              </>
            )}
            {adminEmails.length === 0 && " · admin (unset)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter email or name…"
            className="rounded-md border border-line bg-bg-card px-3 py-1.5 text-sm w-full sm:w-56"
          />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Re-fetch user list"
            className="flex items-center justify-center rounded-md border border-line bg-bg-card text-ink-dim hover:text-ink p-1.5 disabled:opacity-50"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-bg-card overflow-hidden">
        <div className="px-4 py-2 bg-bg-soft border-b border-line flex items-center gap-2">
          <Users size={14} className="text-ink-faint" />
          <span className="text-sm font-semibold">All users</span>
          {search && (
            <span className="text-sm text-ink-faint">
              · {filtered.length} match
            </span>
          )}
        </div>

        <MobileTable
          items={filtered}
          keyOf={(u) => u.id}
          empty={
            search
              ? `No users match "${search}".`
              : "No users have signed in yet."
          }
          renderCard={(u) => {
            const isAdmin = adminEmails.includes(u.email.toLowerCase());
            return (
              <div className="rounded-lg border border-line bg-bg-card p-3">
                <div className="flex items-start gap-3">
                  {u.picture ? (
                    <img
                      src={u.picture}
                      alt=""
                      className="w-9 h-9 rounded-full shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-accent text-bg flex items-center justify-center text-sm font-semibold shrink-0">
                      {(u.name || u.email).slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate">
                        {u.name || u.email}
                      </span>
                      {isAdmin && (
                        <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium shrink-0">
                          <Shield size={9} /> admin
                        </span>
                      )}
                    </div>
                    {u.name && (
                      <div className="text-ink-faint text-sm font-mono truncate">
                        {u.email}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-line/50 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint leading-tight">
                      Last login
                    </div>
                    <div className="text-sm tabular-nums leading-tight">
                          {fmtTs(u.last_login_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint leading-tight">
                      Joined
                    </div>
                    <div className="text-sm tabular-nums leading-tight">
                          {fmtTs(u.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
          renderTable={() => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-ink-faint text-sm uppercase bg-bg-soft border-b border-line">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">User</th>
                    <th
                      className="text-left px-3 py-2 font-medium cursor-pointer hover:text-ink"
                      onClick={() => handleSort("email")}
                    >
                      Email <SortIcon k="email" />
                    </th>
                    <th
                      className="text-right px-3 py-2 font-medium cursor-pointer hover:text-ink"
                      onClick={() => handleSort("last_login_at")}
                    >
                      Last login <SortIcon k="last_login_at" />
                    </th>
                    <th
                      className="text-right px-3 py-2 font-medium cursor-pointer hover:text-ink"
                      onClick={() => handleSort("created_at")}
                    >
                      Joined <SortIcon k="created_at" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {filtered.map((u) => {
                    const isAdmin = adminEmails.includes(u.email.toLowerCase());
                    return (
                      <tr key={u.id} className="hover:bg-bg-soft/40">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {u.picture ? (
                              <img
                                src={u.picture}
                                alt=""
                                className="w-7 h-7 rounded-full shrink-0"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-accent text-bg flex items-center justify-center text-xs font-semibold shrink-0">
                                {(u.name || u.email).slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-medium truncate flex items-center gap-1.5">
                                <span className="truncate">
                                  {u.name || u.email}
                                </span>
                                {isAdmin && (
                                  <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium shrink-0">
                                    <Shield size={9} /> admin
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-ink-dim whitespace-nowrap">
                          {u.email}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {fmtTs(u.last_login_at)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-ink-faint">
                      {fmtTs(u.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        />
      </div>
    </div>
  );
}

type SortKey = "email" | "last_login_at" | "created_at";