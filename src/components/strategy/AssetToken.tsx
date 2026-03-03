"use client";

import Image from "next/image";
import type { Asset } from "@/lib/graphql/types";

interface AssetTokenProps {
  asset: Asset;
  selected?: boolean;
  onClick?: () => void;
  showLabel?: boolean;
  size?: number;
}

export default function AssetToken({
  asset,
  selected,
  onClick,
  showLabel,
  size = 40,
}: AssetTokenProps) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5"
      title={asset.name}
    >
      <div
        className={`relative rounded-full transition-all duration-300 ease-out ${
          selected
            ? "scale-110 border-2 border-brand shadow-[0_0_12px_rgba(41,115,255,0.4)]"
            : "border-2 border-transparent hover:border-text-tertiary/30"
        }`}
        style={{ width: size + 4, height: size + 4 }}
      >
        <Image
          src={asset.logoURI}
          alt={asset.symbol}
          width={size}
          height={size}
          className="rounded-full"
          style={{ width: size, height: size, margin: "auto", display: "block", marginTop: 0, position: "relative", top: "50%", transform: "translateY(-50%)" }}
          unoptimized
        />
      </div>
      {showLabel && (
        <span
          className={`text-xs font-medium transition-all duration-200 ${
            selected ? "text-text-primary" : "text-text-tertiary"
          }`}
        >
          {asset.symbol}
        </span>
      )}
    </button>
  );
}
