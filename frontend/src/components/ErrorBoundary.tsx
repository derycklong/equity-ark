import { Component, ErrorInfo, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Box sx={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>
          <Stack spacing={2} sx={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
            <Typography variant="h2">Something went wrong</Typography>
            <Alert severity="error" variant="outlined" sx={{ textAlign: "left" }}>
              {this.state.error.message || "Unknown error"}
            </Alert>
            <Stack direction="row" spacing={1} sx={{ justifyContent: "center" }}>
              <Button
                variant="outlined"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </Button>
              <Button component={Link} to="/" variant="contained">Go home</Button>
            </Stack>
          </Stack>
        </Box>
      );
    }
    return this.props.children;
  }
}
