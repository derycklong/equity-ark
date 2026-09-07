import { Box, CircularProgress, Stack, Typography } from "@mui/material";

interface LoadingScreenProps {
  label?: string;
}

export function LoadingScreen({ label = "Loading…" }: LoadingScreenProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "text.secondary" }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <CircularProgress size={24} thickness={4} />
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 650 }}>{label}</Typography>
      </Stack>
    </Box>
  );
}

export function LoadingInline() {
  return <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 6 }}><LoadingScreen label="Loading…" /></Box>;
}
