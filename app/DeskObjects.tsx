// 桌上每个物件的插画（SVG）。以后换成照片时，这个文件可以不用。

export function Laptop() {
  return (
    <svg viewBox="0 0 300 200" aria-hidden="true">
      <defs>
        <linearGradient id="lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6e3dd" />
          <stop offset="1" stopColor="#c9c5bd" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="292" height="192" rx="16" fill="url(#lid)" />
      <rect x="4" y="182" width="292" height="14" rx="7" fill="#b7b2a9" />
      <circle cx="78" cy="62" r="24" fill="#141413" />
      <text x="78" y="68" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" fontFamily="var(--font-display)">HaX</text>
      <rect x="176" y="40" width="74" height="28" rx="14" fill="#f2a43a" />
      <text x="213" y="59" textAnchor="middle" fontSize="12" fontWeight="700" fill="#141413" fontFamily="var(--font-display)">MCP</text>
      <rect x="120" y="120" width="96" height="30" rx="6" fill="#fff" />
      <text x="168" y="140" textAnchor="middle" fontSize="11" fill="#141413" fontFamily="var(--font-body)">ship it, then fix it</text>
      <path d="M238 128l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z" fill="#141413" />
    </svg>
  );
}

export function Storyboard() {
  return (
    <svg viewBox="0 0 220 150" aria-hidden="true">
      <rect x="2" y="2" width="216" height="146" rx="10" fill="#fbfaf7" />
      <text x="16" y="28" fontSize="11" fontWeight="800" letterSpacing="1.5" fill="#141413" fontFamily="var(--font-display)">PHOTO → SHORT</text>
      <rect x="16" y="42" width="56" height="56" rx="5" fill="#2b2b28" />
      <rect x="82" y="42" width="56" height="56" rx="5" fill="#3d3c37" />
      <rect x="148" y="42" width="56" height="56" rx="5" fill="#4f4d46" />
      <circle cx="176" cy="70" r="12" fill="#f2a43a" />
      <path d="M172 64l10 6-10 6z" fill="#141413" />
      <text x="16" y="118" fontSize="9" fill="#6e6a62" fontFamily="var(--font-body)">shot 1</text>
      <text x="82" y="118" fontSize="9" fill="#6e6a62" fontFamily="var(--font-body)">shot 2</text>
      <text x="148" y="118" fontSize="9" fill="#6e6a62" fontFamily="var(--font-body)">shot 3</text>
      <path d="M16 134 q 15 -8 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0" fill="none" stroke="#c9c3b7" strokeWidth="1.5" />
    </svg>
  );
}

export function Camera() {
  return (
    <svg viewBox="0 0 200 130" aria-hidden="true">
      <rect x="4" y="22" width="192" height="104" rx="18" fill="#232321" />
      <rect x="4" y="22" width="192" height="24" rx="12" fill="#2f2f2c" />
      <rect x="28" y="8" width="34" height="20" rx="6" fill="#2f2f2c" />
      <circle cx="150" cy="16" r="10" fill="#3a3a36" />
      <circle cx="104" cy="80" r="40" fill="#121211" />
      <circle cx="104" cy="80" r="30" fill="#1d1d1b" stroke="#3a3a36" strokeWidth="3" />
      <circle cx="104" cy="80" r="16" fill="#0b0b0a" />
      <circle cx="96" cy="72" r="5" fill="#ffffff" opacity=".35" />
      <circle cx="168" cy="40" r="5" fill="#f2a43a" />
    </svg>
  );
}

export function Badge() {
  return (
    <svg viewBox="0 0 140 230" aria-hidden="true">
      <path d="M52 0 L60 70 M88 0 L80 70" stroke="#8b2332" strokeWidth="9" strokeLinecap="round" />
      <rect x="56" y="64" width="28" height="18" rx="4" fill="#9a968e" />
      <rect x="6" y="78" width="128" height="148" rx="12" fill="#fbfaf7" />
      <rect x="6" y="78" width="128" height="30" rx="12" fill="#8b2332" />
      <rect x="6" y="96" width="128" height="12" fill="#8b2332" />
      <text x="70" y="98" textAnchor="middle" fontSize="11" fontWeight="800" letterSpacing="2" fill="#f3c74a" fontFamily="var(--font-display)">USC</text>
      <rect x="44" y="118" width="52" height="56" rx="6" fill="#d8d3c9" />
      <circle cx="70" cy="140" r="11" fill="#b4aea3" />
      <rect x="54" y="154" width="32" height="16" rx="8" fill="#b4aea3" />
      <text x="70" y="194" textAnchor="middle" fontSize="11" fontWeight="800" fill="#141413" fontFamily="var(--font-display)">JINGWEN WANG</text>
      <text x="70" y="210" textAnchor="middle" fontSize="8.5" fill="#6e6a62" fontFamily="var(--font-body)">M.S. Applied Data Science</text>
    </svg>
  );
}

export function Resume() {
  return (
    <svg viewBox="0 0 170 220" aria-hidden="true">
      <rect x="2" y="2" width="166" height="216" rx="3" fill="#ffffff" />
      <text x="18" y="32" fontSize="13" fontWeight="800" fill="#141413" fontFamily="var(--font-display)">JINGWEN WANG</text>
      <rect x="18" y="40" width="80" height="4" rx="2" fill="#c9c3b7" />
      {[62, 98, 134, 170].map((y) => (
        <g key={y}>
          <rect x="18" y={y} width="44" height="5" rx="2" fill="#141413" />
          <rect x="18" y={y + 11} width="134" height="3.5" rx="1.75" fill="#d9d4ca" />
          <rect x="18" y={y + 19} width="118" height="3.5" rx="1.75" fill="#d9d4ca" />
        </g>
      ))}
    </svg>
  );
}

export function Phone() {
  return (
    <svg viewBox="0 0 110 210" aria-hidden="true">
      <rect x="3" y="3" width="104" height="204" rx="20" fill="#1b1b1a" />
      <rect x="10" y="12" width="90" height="186" rx="14" fill="#2b2b28" />
      <rect x="40" y="18" width="30" height="8" rx="4" fill="#1b1b1a" />
      <text x="55" y="92" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily="var(--font-display)">say hi</text>
      <rect x="30" y="106" width="50" height="34" rx="6" fill="none" stroke="#f2a43a" strokeWidth="3" />
      <path d="M31 108 L55 126 L79 108" fill="none" stroke="#f2a43a" strokeWidth="3" />
    </svg>
  );
}

export function Notebook() {
  return (
    <svg viewBox="0 0 160 210" aria-hidden="true">
      <rect x="4" y="4" width="152" height="202" rx="8" fill="#2a2a27" />
      <rect x="4" y="4" width="14" height="202" rx="6" fill="#20201e" />
      <rect x="128" y="4" width="8" height="202" fill="#8b2332" />
      <rect x="36" y="36" width="80" height="44" rx="4" fill="#fbfaf7" />
      <text x="76" y="56" textAnchor="middle" fontSize="13" fontWeight="800" fill="#141413" fontFamily="var(--font-display)">NOW</text>
      <text x="76" y="71" textAnchor="middle" fontSize="8.5" fill="#6e6a62" fontFamily="var(--font-body)">Nov 2026</text>
    </svg>
  );
}

export function Boba() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="#e9dcc6" />
      <circle cx="50" cy="50" r="36" fill="#d8c4a2" />
      {[
        [38, 56], [52, 62], [60, 48], [44, 44], [58, 66], [34, 46],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5" fill="#3b2a20" opacity=".55" />
      ))}
      <rect x="47" y="-6" width="9" height="62" rx="4.5" fill="#f2a43a" transform="rotate(28 50 50)" />
    </svg>
  );
}
export function StickyNotes() {
  return (
    <svg viewBox="0 0 170 170" aria-hidden="true">
      <rect x="40" y="6" width="120" height="120" rx="3" fill="#cfe3c8" transform="rotate(8 100 66)" />
      <rect x="14" y="30" width="120" height="120" rx="3" fill="#f6d36b" transform="rotate(-5 74 90)" />
      <text x="30" y="64" fontSize="12" fontWeight="800" letterSpacing="1" fill="#141413" fontFamily="var(--font-display)" transform="rotate(-5 74 90)">EXPERIMENTS</text>
      <g transform="rotate(-5 74 90)" stroke="#141413" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M30 86 l5 5 9 -11" />
        <path d="M54 86 h56" opacity=".5" />
        <path d="M31 108 l12 12 M43 108 l-12 12" />
        <path d="M54 114 h46" opacity=".5" />
        <path d="M30 134 h10" />
        <path d="M54 134 h52" opacity=".5" />
      </g>
    </svg>
  );
}
