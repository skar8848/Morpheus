export function formatApy(value: number): string {
  const pct = value * 100;
  const sign = pct > 0 ? "" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatApyWithSign(value: number): string {
  const pct = value * 100;
  if (pct > 0) return `+${pct.toFixed(2)}%`;
  return `${pct.toFixed(2)}%`;
}

export function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatLltv(lltv: string): string {
  const pct = (Number(lltv) / 1e18) * 100;
  return `${pct.toFixed(0)}%`;
}

export function formatTokenAmount(value: string, decimals: number): string {
  // Use BigInt + string math to avoid Number() precision loss on large values
  try {
    const raw = BigInt(value);
    const divisor = 10n ** BigInt(decimals);
    const intPart = raw / divisor;
    const fracPart = raw % divisor;
    // Convert to float only after dividing (precision preserved for display)
    const fracStr = fracPart.toString().padStart(decimals, "0").slice(0, 6);
    const num = parseFloat(`${intPart}.${fracStr}`);
    if (!isFinite(num)) return "0.00";
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toFixed(2);
  } catch {
    return "0.00";
  }
}
