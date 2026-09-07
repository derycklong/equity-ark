import { createTheme } from "@mui/material/styles";

export type ThemeMode = "light" | "dark";

const palette = {
  dark: {
    background: { default: "#0b0d12", paper: "#11141b" },
    text: { primary: "#e5e7eb", secondary: "#9ca3af", disabled: "#6b7280" },
    divider: "#222632",
    primary: { main: "#60a5fa", light: "#93c5fd", dark: "#2563eb", contrastText: "#08111f" },
    secondary: { main: "#a78bfa", light: "#c4b5fd", dark: "#7c3aed", contrastText: "#10091f" },
    success: { main: "#22c55e", light: "#86efac", dark: "#16a34a", contrastText: "#06130a" },
    error: { main: "#ef4444", light: "#fca5a5", dark: "#dc2626", contrastText: "#1f0707" },
    warning: { main: "#f59e0b", light: "#fcd34d", dark: "#d97706", contrastText: "#1c1102" },
    info: { main: "#38bdf8", light: "#7dd3fc", dark: "#0284c7", contrastText: "#04141d" },
  },
  light: {
    background: { default: "#f8fafc", paper: "#ffffff" },
    text: { primary: "#0f172a", secondary: "#475569", disabled: "#94a3b8" },
    divider: "#e2e8f0",
    primary: { main: "#2563eb", light: "#60a5fa", dark: "#1d4ed8", contrastText: "#ffffff" },
    secondary: { main: "#7c3aed", light: "#a78bfa", dark: "#6d28d9", contrastText: "#ffffff" },
    success: { main: "#16a34a", light: "#4ade80", dark: "#15803d", contrastText: "#ffffff" },
    error: { main: "#dc2626", light: "#f87171", dark: "#b91c1c", contrastText: "#ffffff" },
    warning: { main: "#d97706", light: "#fbbf24", dark: "#b45309", contrastText: "#ffffff" },
    info: { main: "#0284c7", light: "#38bdf8", dark: "#0369a1", contrastText: "#ffffff" },
  },
} as const;

export function createAppTheme(mode: ThemeMode) {
  const colors = palette[mode];

  return createTheme({
    breakpoints: {
      values: { xs: 0, sm: 640, md: 768, lg: 1024, xl: 1400 },
    },
    palette: {
      mode,
      ...colors,
    },
    typography: {
      fontFamily: "var(--app-font-family)",
      h1: { fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em" },
      h2: { fontSize: "1.125rem", fontWeight: 700, letterSpacing: "-0.01em" },
      h3: { fontSize: "1rem", fontWeight: 700 },
      body1: { fontSize: "0.875rem" },
      body2: { fontSize: "0.8125rem" },
      caption: { fontSize: "0.6875rem", letterSpacing: "0.02em" },
      button: { fontSize: "0.8125rem", fontWeight: 650, textTransform: "none" },
    },
      shape: { borderRadius: 12 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          "*, *::before, *::after": { boxSizing: "border-box" },
          body: { transition: "background-color 160ms ease, color 160ms ease" },
          "::selection": {
            backgroundColor: mode === "dark" ? "rgba(96, 165, 250, 0.28)" : "rgba(37, 99, 235, 0.18)",
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            border: `1px solid ${colors.divider}`,
            borderRadius: 14,
            backgroundImage: "none",
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: colors.background.paper,
            color: colors.text.primary,
            borderBottom: `1px solid ${colors.divider}`,
            backgroundImage: "none",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: colors.background.paper,
            backgroundImage: "none",
            borderColor: colors.divider,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 10, minHeight: 38, paddingInline: 14 },
          sizeSmall: { minHeight: 32, paddingInline: 10 },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: 10 },
        },
      },
      MuiTextField: {
        defaultProps: { size: "small", variant: "outlined" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            backgroundColor: mode === "dark" ? "rgba(22, 26, 35, 0.72)" : "rgba(248, 250, 252, 0.72)",
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: colors.text.secondary },
          },
        },
      },
      MuiSelect: {
        styleOverrides: { select: { minHeight: "unset" } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: colors.divider, padding: "9px 12px" },
          head: {
            color: colors.text.secondary,
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            backgroundColor: mode === "dark" ? "rgba(17, 20, 27, 0.86)" : "rgba(238, 242, 247, 0.72)",
          },
        },
      },
      MuiTableSortLabel: {
        styleOverrides: {
          root: { color: colors.text.secondary, "&:hover": { color: colors.text.primary }, "&.Mui-active": { color: `${colors.text.primary} !important` } },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 650 },
          sizeSmall: { height: 24 },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { border: `1px solid ${colors.divider}`, borderRadius: 16, backgroundImage: "none" },
        },
      },
      MuiAccordion: {
        styleOverrides: {
          root: {
            border: `1px solid ${colors.divider}`,
            backgroundImage: "none",
            "&::before": { display: "none" },
            "&:first-of-type, &:last-of-type": { borderRadius: 12 },
          },
        },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { fontSize: "0.7rem", borderRadius: 7 } },
      },
    },
  });
}
