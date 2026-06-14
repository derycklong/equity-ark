import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useStore } from "../stores/useStore";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "authed" | "unauthed">("loading");
  const location = useLocation();
  const setUser = useStore((s) => s.setUser);

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
  }, [setUser]);

  if (status === "loading") {
    return (
      <div className="min-h-full flex items-center justify-center text-ink-dim">
        Loading…
      </div>
    );
  }
  if (status === "unauthed") {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
