interface CardProps {
  children: React.ReactNode;
  className?: string;
  selected?: boolean;
  onClick?: () => void;
}

export default function Card({
  children,
  className = "",
  selected,
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-[var(--radius)] border bg-bg-card transition-all duration-200 ${
        selected
          ? "border-brand/40 bg-brand/5 shadow-[0_0_16px_rgba(41,115,255,0.1)]"
          : "border-border hover:border-border"
      } ${onClick ? "cursor-pointer hover:bg-bg-secondary" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
