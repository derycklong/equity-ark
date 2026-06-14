interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export default function Logo({ size = "md", showText = true }: LogoProps) {
  const iconSize = size === "sm" ? 20 : size === "md" ? 24 : 40;
  const textSize =
    size === "sm" ? "text-sm" : size === "md" ? "text-lg" : "text-3xl";
  const gap = size === "sm" ? "gap-1.5" : size === "md" ? "gap-2" : "gap-3";

  return (
    <span className={`inline-flex items-center ${gap}`}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Dark background rounded square */}
        <rect width="32" height="32" rx="8" fill="#0f172a" />

        {/* Ark hull — represents the portfolio vessel */}
        <path
          d="M4 22 C4 22 8 26 16 26 C24 26 28 22 28 22 L26 20 C26 20 22 23 16 23 C10 23 6 20 6 20 Z"
          fill="#3b82f6"
          opacity="0.9"
        />

        {/* Equity growth chart bars */}
        <rect x="8" y="14" width="3.5" height="6" rx="1" fill="#60a5fa" opacity="0.5" />
        <rect x="14.25" y="10" width="3.5" height="10" rx="1" fill="#60a5fa" opacity="0.7" />
        <rect x="20.5" y="6" width="3.5" height="14" rx="1" fill="#60a5fa" />

        {/* Trend line connecting the tops */}
        <path
          d="M9.75 12.5 L16 8.5 L22.25 4.5"
          stroke="#a78bfa"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Peak dot */}
        <circle cx="22.25" cy="4.5" r="2" fill="#a78bfa" />
      </svg>

      {showText && (
        <span className={`${textSize} font-semibold tracking-tight`}>
          equity.ark
        </span>
      )}
    </span>
  );
}
