interface LoadingScreenProps {
  label?: string;
}

export function LoadingScreen({ label = "Loading…" }: LoadingScreenProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <style>{`
        @keyframes text-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .text-shimmer {
          background: linear-gradient(
            90deg,
            var(--ink-faint) 0%,
            var(--accent) 50%,
            var(--ink-faint) 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          animation: text-shimmer 2.2s linear infinite;
        }
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: translateY(0);    opacity: 0.4; }
          40%           { transform: translateY(-3px); opacity: 1;   }
        }
        .dot-bounce {
          display: inline-block;
          animation: dot-bounce 1.4s ease-in-out infinite;
        }
      `}</style>

      <div className="inline-flex items-center gap-3">
        <svg
          width="40"
          height="40"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="32" height="32" rx="8" fill="#0f172a" />
          <path
            d="M4 22 C4 22 8 26 16 26 C24 26 28 22 28 22 L26 20 C26 20 22 23 16 23 C10 23 6 20 6 20 Z"
            fill="#3b82f6"
            opacity="0.9"
          />
          <rect x="8" y="14" width="3.5" height="6" rx="1" fill="#60a5fa" opacity="0.5" />
          <rect x="14.25" y="10" width="3.5" height="10" rx="1" fill="#60a5fa" opacity="0.7" />
          <rect x="20.5" y="6" width="3.5" height="14" rx="1" fill="#60a5fa" />
          <path
            d="M9.75 12.5 L16 8.5 L22.25 4.5"
            stroke="#a78bfa"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="22.25" cy="4.5" r="2" fill="#a78bfa" />
        </svg>
        <div className="text-sm text-shimmer font-medium tabular-nums">
          {label}
          <span className="ml-0.5 inline-flex gap-0.5 align-baseline">
            <span className="dot-bounce" style={{ animationDelay: "0s" }}>.</span>
            <span className="dot-bounce" style={{ animationDelay: "0.2s" }}>.</span>
            <span className="dot-bounce" style={{ animationDelay: "0.4s" }}>.</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function LoadingInline() {
  return (
    <div className="flex items-center justify-center py-12">
      <LoadingScreen label="Loading…" />
    </div>
  );
}
