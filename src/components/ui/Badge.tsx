interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "error" | "brand";
}

const variants = {
  default: "bg-bg-secondary text-text-secondary",
  success: "bg-success/10 text-success",
  error: "bg-error/10 text-error",
  brand: "bg-brand/10 text-brand",
};

export default function Badge({ children, variant = "default" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variants[variant]}`}
    >
      {children}
    </span>
  );
}
