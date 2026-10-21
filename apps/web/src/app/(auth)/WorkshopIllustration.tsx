"use client";

export function WorkshopIllustration() {
  return (
    <div className="workshop-illustration-card" aria-hidden="true">
      <svg
        viewBox="0 0 500 210"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="workshop-svg"
      >
        <defs>
          <linearGradient id="liftColumnGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(36% 0.04 235)" />
            <stop offset="50%" stopColor="oklch(48% 0.05 235)" />
            <stop offset="100%" stopColor="oklch(30% 0.03 235)" />
          </linearGradient>

          <linearGradient id="carBodyGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(36% 0.05 235)" />
            <stop offset="100%" stopColor="oklch(22% 0.04 235)" />
          </linearGradient>

          <linearGradient id="carRoofGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(66% 0.185 42 / 0.18)" />
            <stop offset="100%" stopColor="oklch(22% 0.03 235 / 0.8)" />
          </linearGradient>

          <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Lignes d'atelier au sol / repères géométriques */}
        <g opacity="0.25" stroke="oklch(100% 0 0 / 0.1)" strokeWidth="1">
          <line x1="20" y1="188" x2="480" y2="188" />
          <line x1="60" y1="188" x2="30" y2="206" />
          <line x1="160" y1="188" x2="140" y2="206" />
          <line x1="340" y1="188" x2="360" y2="206" />
          <line x1="440" y1="188" x2="470" y2="206" />
        </g>

        {/* Colonnes du pont élévateur d'atelier (Two-post lift) */}
        {/* Colonne Gauche */}
        <g>
          <rect
            x="42"
            y="16"
            width="16"
            height="172"
            rx="3"
            fill="url(#liftColumnGrad)"
            stroke="oklch(100% 0 0 / 0.15)"
            strokeWidth="1"
          />
          <line
            x1="50"
            y1="24"
            x2="50"
            y2="178"
            stroke="oklch(66% 0.185 42)"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.85"
          />
          <path d="M34 188 L66 188 L62 183 L38 183 Z" fill="oklch(28% 0.03 235)" />
          <rect x="39" y="102" width="22" height="18" rx="2" fill="oklch(66% 0.185 42)" />
          <path d="M61 111 L145 118 L145 123 L61 116 Z" fill="oklch(66% 0.185 42)" opacity="0.9" />
          <circle cx="145" cy="120" r="4" fill="oklch(96% 0 0)" />
        </g>

        {/* Colonne Droite */}
        <g>
          <rect
            x="442"
            y="16"
            width="16"
            height="172"
            rx="3"
            fill="url(#liftColumnGrad)"
            stroke="oklch(100% 0 0 / 0.15)"
            strokeWidth="1"
          />
          <line
            x1="450"
            y1="24"
            x2="450"
            y2="178"
            stroke="oklch(66% 0.185 42)"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.85"
          />
          <path d="M434 188 L466 188 L462 183 L438 183 Z" fill="oklch(28% 0.03 235)" />
          <rect x="439" y="102" width="22" height="18" rx="2" fill="oklch(66% 0.185 42)" />
          <path
            d="M439 111 L355 118 L355 123 L439 116 Z"
            fill="oklch(66% 0.185 42)"
            opacity="0.9"
          />
          <circle cx="355" cy="120" r="4" fill="oklch(96% 0 0)" />
        </g>

        {/* Câble / traverse haute */}
        <line
          x1="58"
          y1="24"
          x2="442"
          y2="24"
          stroke="oklch(100% 0 0 / 0.12)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />

        {/* Silhouette Vectorielle du Véhicule (Profil surélevé sur le pont) */}
        <g transform="translate(5, -45)">
          {/* Ombre portée */}
          <ellipse cx="245" cy="195" rx="130" ry="8" fill="oklch(0% 0 0 / 0.4)" />

          {/* Carrosserie principale */}
          <path
            d="M 115 168 
               C 120 156, 135 152, 160 152 
               L 190 152 
               C 215 125, 240 108, 290 106 
               L 350 106 
               C 382 106, 400 126, 418 152 
               L 428 155 
               C 438 158, 442 165, 442 172 
               L 440 178 
               C 440 181, 436 183, 430 183 
               L 396 183 
               C 394 170, 380 160, 362 160 
               C 344 160, 330 170, 328 183 
               L 204 183 
               C 202 170, 188 160, 170 160 
               C 152 160, 138 170, 136 183 
               L 115 183 
               C 110 183, 108 177, 110 172 
               Z"
            fill="url(#carBodyGrad)"
            stroke="oklch(100% 0 0 / 0.3)"
            strokeWidth="1.5"
          />

          {/* Ligne de toit / pavillon */}
          <path
            d="M 195 150 
               C 220 128, 245 110, 292 108 
               L 348 108 
               C 378 108, 396 128, 412 150 
               Z"
            fill="url(#carRoofGrad)"
            stroke="oklch(66% 0.185 42 / 0.6)"
            strokeWidth="1.2"
          />

          {/* Vitres */}
          <path d="M 215 146 L 282 114 L 282 146 Z" fill="oklch(100% 0 0 / 0.08)" />
          <path
            d="M 292 114 L 344 114 C 365 114, 382 130, 394 146 L 292 146 Z"
            fill="oklch(100% 0 0 / 0.08)"
          />
          <line x1="287" y1="112" x2="287" y2="148" stroke="oklch(32% 0.03 235)" strokeWidth="3" />

          {/* Ligne de profil */}
          <path
            d="M 125 168 Q 260 163 430 166"
            stroke="oklch(100% 0 0 / 0.22)"
            strokeWidth="1"
            fill="none"
          />

          {/* Phares */}
          <path
            d="M 425 158 L 438 163 L 424 165 Z"
            fill="oklch(62% 0.135 148)"
            opacity="0.9"
            filter="url(#glowFilter)"
          />
          <path d="M 112 165 L 122 165 L 115 170 Z" fill="oklch(66% 0.185 42)" opacity="0.9" />

          {/* Roues & étriers */}
          <g transform="translate(362, 183)">
            <circle
              cx="0"
              cy="0"
              r="22"
              fill="oklch(16% 0.02 235)"
              stroke="oklch(100% 0 0 / 0.25)"
              strokeWidth="2"
            />
            <circle
              cx="0"
              cy="0"
              r="14"
              fill="none"
              stroke="oklch(100% 0 0 / 0.15)"
              strokeWidth="1"
            />
            <circle cx="0" cy="0" r="10" fill="oklch(30% 0.02 235)" />
            <rect x="-4" y="-10" width="8" height="5" rx="1.5" fill="oklch(66% 0.185 42)" />
            <circle cx="0" cy="0" r="4" fill="oklch(40% 0.03 235)" />
          </g>

          <g transform="translate(170, 183)">
            <circle
              cx="0"
              cy="0"
              r="22"
              fill="oklch(16% 0.02 235)"
              stroke="oklch(100% 0 0 / 0.25)"
              strokeWidth="2"
            />
            <circle
              cx="0"
              cy="0"
              r="14"
              fill="none"
              stroke="oklch(100% 0 0 / 0.15)"
              strokeWidth="1"
            />
            <circle cx="0" cy="0" r="10" fill="oklch(30% 0.02 235)" />
            <rect x="-4" y="-10" width="8" height="5" rx="1.5" fill="oklch(66% 0.185 42)" />
            <circle cx="0" cy="0" r="4" fill="oklch(40% 0.03 235)" />
          </g>
        </g>

        {/* Badges d'Illustration Technique & Télémétrie Atelier */}

        {/* Badge 1 : Statut OR (Haut Gauche) */}
        <g transform="translate(24, 10)">
          <rect
            width="158"
            height="30"
            rx="7"
            fill="oklch(18% 0.03 235 / 0.9)"
            stroke="oklch(100% 0 0 / 0.14)"
            strokeWidth="1"
          />
          <circle cx="14" cy="15" r="3.5" fill="oklch(62% 0.135 148)" />
          <text
            x="25"
            y="14"
            fill="oklch(96% 0 0)"
            fontSize="9.5"
            fontWeight="700"
            fontFamily="sans-serif"
          >
            ORDRE DE RÉPARATION
          </text>
          <text x="25" y="24" fill="oklch(76% 0.015 240)" fontSize="8.5" fontFamily="sans-serif">
            OR-2026-0418 · En cours
          </text>
        </g>

        {/* Badge 2 : Devis & Diagnostic (Haut Droite) */}
        <g transform="translate(318, 10)">
          <rect
            width="158"
            height="30"
            rx="7"
            fill="oklch(18% 0.03 235 / 0.9)"
            stroke="oklch(66% 0.185 42 / 0.35)"
            strokeWidth="1"
          />
          <circle cx="14" cy="15" r="3.5" fill="oklch(66% 0.185 42)" />
          <text
            x="25"
            y="14"
            fill="oklch(96% 0 0)"
            fontSize="9.5"
            fontWeight="700"
            fontFamily="sans-serif"
          >
            DIAGNOSTIC & DEVIS
          </text>
          <text x="25" y="24" fill="oklch(76% 0.015 240)" fontSize="8.5" fontFamily="sans-serif">
            Freinage & révision validés
          </text>
        </g>

        {/* Badge 3 : Plaque & Poste Atelier (Bas Centre) */}
        <g transform="translate(170, 168)">
          <rect
            width="160"
            height="28"
            rx="6"
            fill="oklch(20% 0.03 235 / 0.92)"
            stroke="oklch(100% 0 0 / 0.14)"
            strokeWidth="1"
          />
          <rect
            x="7"
            y="5"
            width="60"
            height="18"
            rx="3"
            fill="oklch(15% 0.02 235)"
            stroke="oklch(100% 0 0 / 0.2)"
            strokeWidth="1"
          />
          <text
            x="11"
            y="18"
            fill="oklch(96% 0 0)"
            fontSize="9"
            fontWeight="800"
            fontFamily="monospace"
            letterSpacing="0.05em"
          >
            2547 GH 01
          </text>
          <text
            x="74"
            y="15"
            fill="oklch(92% 0 0)"
            fontSize="8.5"
            fontWeight="600"
            fontFamily="sans-serif"
          >
            Toyota Corolla
          </text>
          <text
            x="74"
            y="23"
            fill="oklch(66% 0.185 42)"
            fontSize="7.5"
            fontWeight="600"
            fontFamily="sans-serif"
          >
            Pont n°2 · Atelier
          </text>
        </g>
      </svg>
    </div>
  );
}
