import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { BarChart3, Briefcase, Coins, Globe2, Shield, TrendingUp } from "lucide-react";
import { api } from "../lib/api";
import Logo from "../components/Logo";

const FEATURES = [
  { icon: BarChart3, label: "FIFO Cost Basis", desc: "Track exact cost per share with lot-level precision" },
  { icon: TrendingUp, label: "Market Data", desc: "Quotes via yfinance across all supported exchanges" },
  { icon: Coins, label: "Dividend Tracking", desc: "Estimate income received with withholding tax" },
  { icon: Globe2, label: "Multi-Currency", desc: "USD, HKD, SGD, GBP, CNY with historical FX rates" },
  { icon: Briefcase, label: "Closed Positions", desc: "P&L analysis on every completed roundtrip" },
  { icon: Shield, label: "Private & Secure", desc: "Your portfolio data stays private and encrypted" },
];

function GoogleMark() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c-.78-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>;
}

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const errorParam = params.get("error");

  useEffect(() => { api.authMe().then(() => navigate("/", { replace: true })).catch(() => setChecking(false)); }, [navigate]);

  if (checking) return <Box sx={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "text.secondary" }}>Checking session…</Box>;

  return (
    <Box sx={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: { xs: 2, sm: 4 }, position: "relative", overflow: "hidden" }}>
      <Box sx={{ position: "absolute", width: 560, height: 560, top: -280, left: "50%", transform: "translateX(-50%)", borderRadius: "50%", bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.1 : 0.06), filter: "blur(72px)", pointerEvents: "none" }} />
      <Box sx={{ position: "absolute", width: 360, height: 360, bottom: -220, right: "20%", borderRadius: "50%", bgcolor: (theme) => alpha(theme.palette.warning.main, theme.palette.mode === "dark" ? 0.08 : 0.05), filter: "blur(64px)", pointerEvents: "none" }} />
      <Box sx={{ position: "absolute", inset: 0, opacity: { xs: 0.025, sm: 0.04 }, backgroundImage: "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      <Stack spacing={{ xs: 4, sm: 6 }} sx={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 760 }}>
        <Stack spacing={2} sx={{ textAlign: "center", alignItems: "center" }}>
          <Logo size="lg" />
          <Typography component="h1" sx={{ fontSize: { xs: "2rem", sm: "2.75rem" }, lineHeight: 1.08, fontWeight: 700, letterSpacing: "-0.045em" }}>Navigate markets<br /><Box component="span" sx={{ color: "primary.main" }}>with confidence.</Box></Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 480, lineHeight: 1.65 }}>An ark that watches over your portfolio — so you always know where you stand, what's working, and when to act.</Typography>
        </Stack>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" }, gap: { xs: 1, sm: 1.5 } }}>
          {FEATURES.map(({ icon: Icon, label, desc }) => <Card key={label} variant="outlined" sx={{ bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.72 : 0.9), backdropFilter: "blur(8px)" }}><CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: { xs: 1.5, sm: 2 } } }}><Box sx={{ display: "flex", width: "fit-content", p: 1, mb: 1.25, borderRadius: 1.5, bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.14 : 0.08), color: "primary.main" }}><Icon size={16} /></Box><Typography variant="body2" sx={{ fontWeight: 700 }}>{label}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, lineHeight: 1.45 }}>{desc}</Typography></CardContent></Card>)}
        </Box>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          {errorParam && <Alert severity="error" variant="outlined" sx={{ width: "100%", maxWidth: 400 }}>{errorParam === "oauth_failed" ? "Google sign-in failed. Please try again." : errorParam === "no_email" ? "We couldn't get your email from Google. Please try again." : `Sign-in error: ${errorParam}`}</Alert>}
          <Button variant="outlined" size="large" onClick={() => api.authGoogleLogin()} startIcon={<GoogleMark />} sx={{ width: "100%", maxWidth: 400, minHeight: 52, bgcolor: "background.paper", borderColor: "divider", color: "text.primary", "&:hover": { bgcolor: "action.hover", borderColor: "primary.main" } }}>Continue with Google</Button>
          <Typography variant="caption" color="text.secondary" align="center">Your data stays private. Only you can see your portfolio.</Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
