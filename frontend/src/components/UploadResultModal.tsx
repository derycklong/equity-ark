import { CheckCircle2, AlertCircle, FileSpreadsheet, ArrowRight } from "lucide-react";
import Modal from "./Modal";

interface UploadResultModalProps {
  open: boolean;
  onClose: () => void;
  result: { imported: number; skipped: number; errors?: string[] } | null;
  error: string | null;
  fileName: string | null;
  onViewHoldings?: () => void;
}

export default function UploadResultModal({
  open,
  onClose,
  result,
  error,
  fileName,
  onViewHoldings,
}: UploadResultModalProps) {
  const hasError = !!error;
  const imported = result?.imported ?? 0;
  const skipped = result?.skipped ?? 0;
  const errors = result?.errors ?? [];
  const total = imported + skipped;

  return (
    <Modal open={open} onClose={onClose} size="md">
      {hasError ? (
        <ErrorState message={error!} fileName={fileName} onClose={onClose} />
      ) : (
        <SuccessState
          imported={imported}
          skipped={skipped}
          total={total}
          errors={errors}
          fileName={fileName}
          onClose={onClose}
          onViewHoldings={onViewHoldings}
        />
      )}
    </Modal>
  );
}

function ErrorState({ message, fileName, onClose }: { message: string; fileName: string | null; onClose: () => void }) {
  return (
    <div className="p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-full bg-bad/10 text-bad flex items-center justify-center">
          <AlertCircle size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-bad">Upload failed</h3>
          {fileName && (
            <p className="text-sm text-ink-faint mt-0.5 flex items-center gap-1.5 truncate">
              <FileSpreadsheet size={12} className="shrink-0" />
              <span className="truncate">{fileName}</span>
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 rounded-md bg-bad/5 border border-bad/20 px-3 py-2 text-sm text-ink-dim break-words">
        {message}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={onClose}
          className="rounded-md border border-line bg-bg-soft px-4 py-2 text-sm hover:border-ink-dim"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function SuccessState({
  imported,
  skipped,
  total,
  errors,
  fileName,
  onClose,
  onViewHoldings,
}: {
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
  fileName: string | null;
  onClose: () => void;
  onViewHoldings?: () => void;
}) {
  const hasErrors = errors.length > 0 || skipped > 0;
  const accent = hasErrors ? "warn" : "good";

  return (
    <div className="p-5">
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
            accent === "good" ? "bg-good/10 text-good" : "bg-warn/10 text-warn"
          }`}
        >
          <CheckCircle2 size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold">
            {hasErrors ? "Import complete with warnings" : "Import successful"}
          </h3>
          {fileName && (
            <p className="text-sm text-ink-faint mt-0.5 flex items-center gap-1.5 truncate">
              <FileSpreadsheet size={12} className="shrink-0" />
              <span className="truncate">{fileName}</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Imported" value={imported} accent="good" />
        <Stat label="Skipped" value={skipped} accent={skipped > 0 ? "warn" : "dim"} />
        <Stat label="Total rows" value={total} accent="dim" />
      </div>

      {errors.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-sm font-medium text-warn mb-1.5">
            <AlertCircle size={13} />
            Skipped rows ({skipped})
          </div>
          <div className="rounded-md border border-warn/20 bg-warn/5 max-h-40 overflow-y-auto divide-y divide-warn/10">
            {errors.map((e, i) => (
              <div key={i} className="px-3 py-1.5 text-sm text-ink-dim break-words">
                {e}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border border-line bg-bg-soft px-4 py-2 text-sm hover:border-ink-dim"
        >
          Close
        </button>
        {onViewHoldings && (
          <button
            onClick={onViewHoldings}
            className="flex items-center gap-1.5 rounded-md border border-line bg-bg-soft px-4 py-2 text-sm font-medium hover:border-ink-dim"
          >
            View holdings
            <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: "good" | "warn" | "dim" }) {
  const colorClass = accent === "good" ? "text-good" : accent === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-md border border-line bg-bg-soft/50 px-3 py-2 text-center">
      <div className="text-sm uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${colorClass}`}>{value}</div>
    </div>
  );
}
