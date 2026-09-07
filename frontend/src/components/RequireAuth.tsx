import { useEffect, useState } from "react";
import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useStore } from "../stores/useStore";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "authed" | "unauthed">("loading");
  const location = useLocation();
  const setUser = useStore((s) => s.setUser);

  // Re-fetch /api/auth/me on mount AND on every route change so flags
  // like `is_admin` (which depend on env config that may change without
  // a re-login) stay current.
  useEffect(() => {
    api.authMe()
      .then((res) => {
        setUser(res.user);
        setStatus("authed");
      })
      .catch(() => {
        setUser(null);
        setStatus("unauthed");
      });
  }, [setUser, location.pathname]);

  if (status === "loading") {
    return <Box sx={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}><CircularProgress size={18} /><Typography variant="body2">Loading…</Typography></Stack></Box>;
  }
  if (status === "unauthed") {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
