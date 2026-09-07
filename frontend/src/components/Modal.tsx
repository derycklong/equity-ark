import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
} from "@mui/material";
import CloseRounded from "@mui/icons-material/CloseRounded";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
}

const SIZE_MAP: Record<NonNullable<ModalProps["size"]>, "xs" | "sm" | "md"> = {
  sm: "xs",
  md: "sm",
  lg: "md",
};

export default function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  closeOnBackdrop = true,
}: ModalProps) {
  return (
    <Dialog
      open={open}
      onClose={(_, reason) => {
        if (reason === "backdropClick" && !closeOnBackdrop) return;
        onClose();
      }}
      fullWidth
      maxWidth={SIZE_MAP[size]}
      scroll="paper"
      aria-labelledby={title !== undefined ? "app-dialog-title" : undefined}
    >
      {title !== undefined && (
        <DialogTitle id="app-dialog-title" sx={{ pr: 6, fontSize: "0.9375rem", fontWeight: 700 }}>
          {title}
          <IconButton
            onClick={onClose}
            aria-label="Close"
            size="small"
            sx={{ position: "absolute", right: 12, top: 10, color: "text.secondary" }}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        </DialogTitle>
      )}
      <DialogContent dividers={title !== undefined} sx={{ p: title !== undefined ? 0 : 2.5 }}>
        {children}
      </DialogContent>
    </Dialog>
  );
}
