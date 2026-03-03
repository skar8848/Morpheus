"use client";

interface SectionConnectorProps {
  active?: boolean;
}

export default function SectionConnector({ active = false }: SectionConnectorProps) {
  return (
    <div className="flex justify-center py-2">
      <svg width="2" height="48" viewBox="0 0 2 48" className="overflow-visible">
        <defs>
          <linearGradient id="connectorGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2973ff" />
            <stop offset="100%" stopColor="#39a699" />
          </linearGradient>
        </defs>
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="48"
          stroke={active ? "url(#connectorGrad)" : "rgba(255,255,255,0.08)"}
          strokeWidth="2"
          strokeDasharray="6 4"
          style={
            active
              ? { animation: "dash-flow 1s linear infinite" }
              : undefined
          }
        />
        {active && (
          <circle cx="1" cy="48" r="3" fill="#39a699" opacity="0.6">
            <animate
              attributeName="opacity"
              values="0.6;1;0.6"
              dur="1.5s"
              repeatCount="indefinite"
            />
          </circle>
        )}
      </svg>
    </div>
  );
}
