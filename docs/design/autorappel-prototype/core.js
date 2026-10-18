const { useState, useEffect, useRef, useMemo, useContext, createContext } = React;
const { fmtFR, fcfa, daysBetween } = window.AR_HELPERS;

/* ===================== Icons ===================== */
const ICONS = {
  gauge: (
    <>
      <path d="M4 13a8 8 0 1 1 16 0" />
      <path d="M12 13l3.5-4.5" />
      <circle cx="12" cy="13" r="1" />
    </>
  ),
  bell: (
    <>
      <path d="M6 10a6 6 0 1 1 12 0c0 3 1 4.5 1.5 5.5H4.5C5 14.5 6 13 6 10z" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
    </>
  ),
  banknote: (
    <>
      <rect x="2.5" y="6.5" width="19" height="12" rx="2" />
      <circle cx="12" cy="12.5" r="2.5" />
      <path d="M5.5 6.5v0M18.5 17.5v0" />
    </>
  ),
  car: (
    <>
      <path d="M3.5 13.5l1.3-4a2 2 0 0 1 1.9-1.4h10.6a2 2 0 0 1 1.9 1.4l1.3 4" />
      <path d="M3 13.5h18v3.6a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1v-.9H6.2v.9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <circle cx="7.2" cy="17" r="1.4" />
      <circle cx="16.8" cy="17" r="1.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5.5h16v10.5H9l-4 3.5v-3.5H4z" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M4 16v2.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.3M12 18.2v2.3M4.9 7l2 1.15M17.1 7l-2 1.15M4.9 17l2-1.15M17.1 17l-2-1.15M3.5 12h2.3M18.2 12h2.3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M19.5 19.5L15 15" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  x: (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.3M12 19.2v2.3M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.4 19.6L6 18M18 6l1.6-1.6" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  phone: (
    <path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A17 17 0 0 1 5 6.1 1.5 1.5 0 0 1 6.5 3.5z" />
  ),
  alertTriangle: (
    <>
      <path d="M12 4l9 15.5H3z" />
      <path d="M12 10v4M12 17v0" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M8 11l4 4 4-4" />
      <path d="M4 17v1.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V17" />
    </>
  ),
  edit: (
    <>
      <path d="M15 4.5l4.5 4.5L8 20.5H3.5V16z" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  mapPin: (
    <>
      <path d="M12 21s7-6.5 7-11.5a7 7 0 1 0-14 0C5 14.5 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="10" height="18" />
      <rect x="15" y="9" width="5" height="12" />
      <path d="M7 7h4M7 11h4M7 15h4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <circle cx="17.5" cy="9" r="2.3" />
      <path d="M15.5 13a5 5 0 0 1 5.5 6" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 15h4" />
    </>
  ),
  fileText: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  sort: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
  wrench: <path d="M14.5 6.5a4 4 0 0 0-5.5 5l-6 6 2 2 6-6a4 4 0 0 0 5-5.5l-2.5 2.5-2-2z" />,
  whatsapp: (
    <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm4.8 12.7c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1-3.3-1.1-5.5-4.1-5.6-4.3-.2-.3-1.3-1.7-1.3-3.2s.8-2.2 1-2.5c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5s.8 1.9.8 2.1c.1.2.1.4 0 .6-.3.6-.6.8-.9 1.2-.1.2-.3.3-.1.6.5.9 1.2 1.7 2 2.3.3.3.6.5.9.2.3-.2.9-1 1.2-1.3.2-.3.4-.2.7-.1l1.8.9c.2.1.4.2.4.4.1.2.1.6-.1 1.2z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
    </>
  ),
  message: (
    <>
      <path d="M4 5.5h16v10.5H10l-4 3.5v-3.5H4z" />
      <path d="M8 10h8M8 13h5" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5.5-6.5" />
    </>
  ),
  xCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  send: <path d="M3.5 11.5L20 4l-6.5 16.5-3-7z M20 4L10.5 13.5" />,
  undo: <path d="M7.5 8.5H5V4M5 8.5A8 8 0 1 1 6 18" />,
  flag: (
    <>
      <path d="M6 3v18" />
      <path d="M6 4.5h11l-2.5 3.5L17 11.5H6" />
    </>
  ),
  filePlus: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M12 11v6M9 14h6" />
    </>
  ),
  link: (
    <path d="M9.5 14.5l5-5M8 10l-2.5 2.5a3 3 0 0 0 4.2 4.2L12 14.5M16 14l2.5-2.5a3 3 0 0 0-4.2-4.2L12 9.5" />
  ),
  loader: (
    <>
      <circle cx="12" cy="12" r="8.5" opacity="0.25" />
      <path d="M20.5 12A8.5 8.5 0 0 0 12 3.5" />
    </>
  ),
  plug: <path d="M9 3v5M15 3v5M7 8h10l-1 4a4 4 0 0 1-8 0zM12 16v5" />,
  truck: (
    <>
      <rect x="2.5" y="8" width="11" height="8" />
      <path d="M13.5 11h4l3 3v2h-7z" />
      <circle cx="6" cy="17.5" r="1.6" />
      <circle cx="17" cy="17.5" r="1.6" />
    </>
  ),
  shield: <path d="M12 3l7 3v5.5c0 5-3.5 8-7 9.5-3.5-1.5-7-4.5-7-9.5V6z" />,
  logout: (
    <>
      <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9" />
      <path d="M14 16l4-4-4-4M18 12H9" />
    </>
  ),
};
function Icon({ name, size = 18, strokeWidth = 1.9, className = "", style }) {
  const content = ICONS[name];
  if (!content) return null;
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {content}
    </svg>
  );
}

/* ===================== Tooltip ===================== */
function Tip({ text, children, align = "center" }) {
  if (!text) return children;
  return (
    <span className="tt-wrap" tabIndex={0}>
      {children}
      <span
        className="tt-bubble"
        role="tooltip"
        style={align === "left" ? { left: 0, transform: "none" } : undefined}
      >
        {text}
      </span>
    </span>
  );
}

/* ===================== Status / type / channel pills ===================== */
const STATUS_TONE = { ok: "pill-ok", warn: "pill-warn", bad: "pill-bad", off: "pill-off" };
function StatusPill({ tone, children, tooltip }) {
  const el = (
    <span className={"pill " + (STATUS_TONE[tone] || "pill-off")}>
      <span className="dot" />
      {children}
    </span>
  );
  return tooltip ? <Tip text={tooltip}>{el}</Tip> : el;
}
const TYPE_META = {
  vt: {
    icon: "shield",
    label: "Visite technique",
    tt: "VT — contrôle technique obligatoire du véhicule",
  },
  revision: {
    icon: "wrench",
    label: "Révision",
    tt: "Entretien périodique selon date ou kilométrage",
  },
  creance: { icon: "banknote", label: "Créance", tt: "Facture impayée à relancer" },
};
function TypePill({ type, compact }) {
  const m = TYPE_META[type] || TYPE_META.vt;
  return (
    <Tip text={m.tt}>
      <span className="pill pill-type">
        <Icon name={m.icon} size={13} />
        {!compact && m.label}
      </span>
    </Tip>
  );
}
const CHAN_META = {
  whatsapp: { cls: "chan-whatsapp", label: "WhatsApp", icon: "whatsapp" },
  sms: { cls: "chan-sms", label: "SMS", icon: "message" },
  email: { cls: "chan-email", label: "Email", icon: "mail" },
};
function ChanPill({ canal, compact }) {
  const m = CHAN_META[canal] || CHAN_META.sms;
  return (
    <Tip text={"Canal : " + m.label}>
      <span className={"chan-pill " + m.cls}>
        <Icon name={m.icon} size={11} strokeWidth={2.3} />
        {!compact && m.label}
      </span>
    </Tip>
  );
}
function PalierBadge({ palier }) {
  const strong = palier === "Relance ferme" || palier === "Alerte gérant";
  return (
    <Tip text="Palier de relance : étape dans la séquence de rappels">
      <span className={"palier-badge" + (strong ? " strong" : "")}>{palier}</span>
    </Tip>
  );
}

/* ===================== KPI card ===================== */
function KpiCard({ icon, label, value, sub, subTone = "bad", tooltip, onClick }) {
  return (
    <div
      className="kpi-card"
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter") onClick();
            }
          : undefined
      }
    >
      <div className="kpi-top">
        <div className="kpi-icon">
          <Icon name={icon} size={18} />
        </div>
        {tooltip && (
          <Tip text={tooltip} align="left">
            <span style={{ color: "var(--muted)", display: "flex" }}>
              <Icon name="info" size={15} />
            </span>
          </Tip>
        )}
      </div>
      <div className="kpi-value num">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className={"kpi-sub" + (subTone === "ok" ? " ok" : "")}>{sub}</div>}
    </div>
  );
}

/* ===================== Countdown & km progress ===================== */
function Countdown({ days, size = 40 }) {
  let tone = "var(--status-ok)",
    bg = "var(--status-ok-bg)",
    text = "J-" + days;
  if (days < 0) {
    tone = "var(--status-bad)";
    bg = "var(--status-bad-bg)";
    text = "J+" + Math.abs(days);
  } else if (days <= 7) {
    tone = "var(--status-bad)";
    bg = "var(--status-bad-bg)";
  } else if (days <= 30) {
    tone = "var(--status-warn)";
    bg = "var(--status-warn-bg)";
  }
  return (
    <Tip
      text={
        days < 0
          ? "Expiré depuis " + Math.abs(days) + " jour(s)"
          : "Expire dans " + days + " jour(s)"
      }
    >
      <span
        className="countdown-ring"
        style={{ width: size, height: size, background: bg, color: tone }}
      >
        {text}
      </span>
    </Tip>
  );
}
function KmProgress({ percent, remainingLabel }) {
  const cls = percent >= 100 ? "bad" : percent >= 80 ? "warn" : "";
  return (
    <Tip text={remainingLabel || percent + "% de l\u2019intervalle parcouru"}>
      <span className={"km-progress " + cls} style={{ display: "block" }}>
        <span style={{ width: Math.min(100, percent) + "%" }} />
      </span>
    </Tip>
  );
}

/* ===================== Alert banner / list ===================== */
function AlertBanner({ tone = "info", children }) {
  return (
    <div className={"alert-banner " + tone}>
      <span className="icon">
        <Icon name={tone === "warn" ? "alertTriangle" : "info"} size={18} />
      </span>
      <span className="txt">{children}</span>
    </div>
  );
}
function AlertList({ items, onGo }) {
  return (
    <div className="alert-list">
      {items.map((a) => (
        <div className={"alert-row" + (a.niveau === "warn" ? " warn" : "")} key={a.id}>
          <span className="ic">
            <Icon name="alertTriangle" size={16} />
          </span>
          <span style={{ flex: 1 }}>{a.texte}</span>
          {onGo && (
            <button className="link-btn" onClick={() => onGo(a.lien)}>
              Voir
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ===================== Modal ===================== */
function Modal({ title, onClose, children, footer, size }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={"modal" + (size === "lg" ? " modal-lg" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h3 style={{ fontSize: 17 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ===================== Toasts ===================== */
function ToastHost({ toasts }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div className={"toast " + (t.type || "")} key={t.id}>
          <span className="ic">
            <Icon
              name={t.type === "err" ? "xCircle" : t.type === "ok" ? "checkCircle" : "info"}
              size={17}
            />
          </span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ===================== Empty / skeleton ===================== */
function EmptyState({ icon = "checkCircle", title, text, action }) {
  return (
    <div className="empty-state">
      <div className="ic">
        <Icon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      {text && <p style={{ maxWidth: 360, fontSize: 13.5 }}>{text}</p>}
      {action}
    </div>
  );
}
function Skeleton({ w = "100%", h = 14, r = 6 }) {
  return (
    <span className="skeleton" style={{ display: "block", width: w, height: h, borderRadius: r }} />
  );
}
function SkeletonCard() {
  return (
    <div className="card">
      <Skeleton w="40%" h={12} />
      <div style={{ height: 14 }} />
      <Skeleton w="70%" h={26} />
      <div style={{ height: 10 }} />
      <Skeleton w="50%" h={12} />
    </div>
  );
}

/* ===================== Pagination & sort header ===================== */
function Pagination({ page, totalPages, onChange, totalLabel }) {
  if (totalPages <= 1)
    return (
      <div className="table-pagination">
        <span>{totalLabel}</span>
      </div>
    );
  const pages = [];
  for (let i = 1; i <= totalPages; i++) pages.push(i);
  return (
    <div className="table-pagination">
      <span>{totalLabel}</span>
      <div className="pages">
        <button
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
          aria-label="Page précédente"
        >
          <Icon name="chevronLeft" size={14} />
        </button>
        {pages.map((p) => (
          <button key={p} className={p === page ? "active" : ""} onClick={() => onChange(p)}>
            {p}
          </button>
        ))}
        <button
          disabled={page === totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Page suivante"
        >
          <Icon name="chevronRight" size={14} />
        </button>
      </div>
    </div>
  );
}
function SortTh({ label, sortKey, active, dir, onSort, tooltip }) {
  const content = (
    <>
      {label}
      {active && (
        <Icon
          name={dir === "asc" ? "chevronDown" : "chevronDown"}
          size={12}
          style={{
            marginLeft: 4,
            transform: dir === "asc" ? "rotate(180deg)" : "none",
            verticalAlign: "middle",
          }}
        />
      )}
    </>
  );
  return (
    <th className={sortKey ? "sortable" : ""} onClick={sortKey ? () => onSort(sortKey) : undefined}>
      {tooltip ? <Tip text={tooltip}>{content}</Tip> : content}
    </th>
  );
}
function sortRows(rows, key, dir, getVal) {
  const g = getVal || ((r) => r[key]);
  const sorted = [...rows].sort((a, b) => {
    const va = g(a, key),
      vb = g(b, key);
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb), "fr");
  });
  if (dir === "desc") sorted.reverse();
  return sorted;
}
function paginate(rows, page, pageSize) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/* ===================== Variable chip & message preview ===================== */
function VariableChip({ name, onInsert }) {
  return (
    <button type="button" className="var-chip" onClick={() => onInsert("{" + name + "}")}>
      {"{" + name + "}"}
    </button>
  );
}
const VARIABLES = [
  "client",
  "vehicule",
  "plaque",
  "date_expiration",
  "montant",
  "facture",
  "lien_paiement",
  "garage",
  "telephone_garage",
];

function MessagePreview({ canal, message, objet, client, garage, defaultCanal }) {
  const [tab, setTab] = useState(canal || defaultCanal || "whatsapp");
  const garageNom = garage || window.AR_DATA.garage.nom;
  const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div>
      <div className="preview-tabs">
        <button
          className={"preview-tab wa" + (tab === "whatsapp" ? " active" : "")}
          onClick={() => setTab("whatsapp")}
        >
          <Icon name="whatsapp" size={13} />
          WhatsApp
        </button>
        <button
          className={"preview-tab sms" + (tab === "sms" ? " active" : "")}
          onClick={() => setTab("sms")}
        >
          <Icon name="message" size={13} />
          SMS
        </button>
        <button
          className={"preview-tab mail" + (tab === "email" ? " active" : "")}
          onClick={() => setTab("email")}
        >
          <Icon name="mail" size={13} />
          Email
        </button>
      </div>
      {tab === "whatsapp" && (
        <div className="phone-frame">
          <div className="phone-screen">
            <div className="wa-head">
              <Icon name="user" size={16} />
              {client ? client.nom : "Client"}
            </div>
            <div className="wa-body">
              <div className="wa-bubble">
                {message}
                <span className="time">{time} ✓✓</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {tab === "sms" && (
        <div className="phone-frame">
          <div className="sms-screen">
            <div className="sms-head">{garageNom}</div>
            <div className="sms-body">
              <div className="sms-bubble">{message}</div>
            </div>
            <div className="sms-counter">
              {message.length} caractères · {Math.ceil(message.length / 160)} SMS
            </div>
          </div>
        </div>
      )}
      {tab === "email" && (
        <div className="email-frame">
          <div className="email-head">
            De : {garageNom} &lt;contact@excellence-auto.ci&gt;
            <div className="subject">{objet || "Concernant votre dossier — " + garageNom}</div>
          </div>
          <div className="email-body">{message}</div>
        </div>
      )}
    </div>
  );
}

/* ===================== App context ===================== */
const AppContext = createContext(null);
function useApp() {
  return useContext(AppContext);
}

/* ===================== Navigation ===================== */
const NAV_PRIMARY = [
  { id: "dashboard", label: "Tableau de bord", icon: "gauge" },
  { id: "relances", label: "Relances du jour", icon: "bell", badgeKey: "relances" },
  { id: "creances", label: "Créances", icon: "banknote" },
  { id: "clients", label: "Clients & véhicules", icon: "car" },
];
const NAV_MORE = [
  { id: "echeances", label: "Échéances VT & révisions", icon: "calendar" },
  { id: "historique", label: "Historique des envois", icon: "list" },
  { id: "modeles", label: "Modèles de messages", icon: "chat" },
  { id: "import", label: "Import des données", icon: "upload" },
  { id: "parametres", label: "Paramètres", icon: "gear" },
];
const ALL_NAV = NAV_PRIMARY.concat(NAV_MORE);

function NavButton({ item, active, onClick, badge }) {
  return (
    <button className={"nav-item" + (active ? " active" : "")} onClick={onClick}>
      <span className="ic">
        <Icon name={item.icon} size={18} />
      </span>
      <span className="label">{item.label}</span>
      {badge > 0 && <span className="badge">{badge}</span>}
    </button>
  );
}

function Sidebar({ view, navigate, collapsed, setCollapsed, counts }) {
  const { garage } = useApp().data;
  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="sidebar-head">
        <div className="sidebar-logo">EA</div>
        <div className="sidebar-garage">
          <div className="name">{garage.nom}</div>
          <div className="sub">{garage.quartier}</div>
        </div>
        <Tip text={collapsed ? "Déplier le menu" : "Replier le menu"}>
          <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
          </button>
        </Tip>
      </div>
      <nav className="sidebar-nav">
        {NAV_PRIMARY.map((it) => (
          <NavButton
            key={it.id}
            item={it}
            active={view === it.id}
            onClick={() => navigate(it.id)}
            badge={it.badgeKey ? counts[it.badgeKey] : 0}
          />
        ))}
        <div className="sidebar-section-label">Plus</div>
        {NAV_MORE.map((it) => (
          <NavButton
            key={it.id}
            item={it}
            active={view === it.id}
            onClick={() => navigate(it.id)}
          />
        ))}
      </nav>
      <div className="sidebar-foot">{!collapsed && "AutoRappel · v1.0"}</div>
    </aside>
  );
}

function BottomTabBar({ view, navigate, counts, onMore }) {
  const tabs = [
    { id: "dashboard", label: "Accueil", icon: "gauge" },
    { id: "relances", label: "Relances", icon: "bell", badge: counts.relances },
    { id: "creances", label: "Créances", icon: "banknote" },
    { id: "clients", label: "Clients", icon: "car" },
    { id: "more", label: "Plus", icon: "more" },
  ];
  return (
    <nav className="bottom-tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={"bottom-tab" + (view === t.id ? " active" : "")}
          onClick={() => (t.id === "more" ? onMore() : navigate(t.id))}
        >
          <Icon name={t.icon} size={21} strokeWidth={view === t.id ? 2.3 : 1.9} />
          {t.label}
          {t.badge > 0 && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </nav>
  );
}

function PlusSheet({ view, navigate, onClose, onLogout, theme, setTheme }) {
  return (
    <div
      className="plus-sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="plus-sheet">
        <div className="handle" />
        <div className="plus-sheet-head">
          <h3 style={{ fontSize: 16 }}>Plus</h3>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {NAV_MORE.map((it) => (
          <NavButton
            key={it.id}
            item={it}
            active={view === it.id}
            onClick={() => {
              navigate(it.id);
              onClose();
            }}
          />
        ))}
        <hr className="sep" />
        <button className="nav-item" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <span className="ic">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
          </span>
          <span className="label">Thème {theme === "dark" ? "clair" : "sombre"}</span>
        </button>
        <button className="nav-item" onClick={onLogout}>
          <span className="ic">
            <Icon name="logout" size={18} />
          </span>
          <span className="label">Déconnexion</span>
        </button>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const { data } = useApp();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const results = useMemo(() => {
    if (!q.trim()) return { clients: [], vehicles: [], invoices: [] };
    const needle = q.toLowerCase();
    const clients = data.clients
      .filter((c) => c.nom.toLowerCase().includes(needle) || c.telephone.includes(needle))
      .slice(0, 4);
    const vehicles = data.vehicles
      .filter(
        (v) =>
          v.plaque.toLowerCase().includes(needle.replace(/\s/g, "")) ||
          v.plaque.toLowerCase().includes(needle),
      )
      .slice(0, 4);
    const invoices = data.invoices
      .filter((i) => i.numero.toLowerCase().includes(needle))
      .slice(0, 4);
    return { clients, vehicles, invoices };
  }, [q, data]);
  const { navigate } = useApp();
  const hasResults = results.clients.length || results.vehicles.length || results.invoices.length;
  return (
    <div className="search-box" ref={ref} style={{ position: "relative" }}>
      <Icon name="search" size={16} />
      <input
        placeholder="Rechercher un client, téléphone, plaque, n° facture…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && q.trim() && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "var(--shadow-md)",
            zIndex: 60,
            maxHeight: 320,
            overflowY: "auto",
            padding: 6,
          }}
        >
          {!hasResults && (
            <div style={{ padding: 14, fontSize: 13, color: "var(--muted)" }}>
              Aucun résultat pour « {q} »
            </div>
          )}
          {results.clients.map((c) => (
            <button
              key={c.id}
              className="nav-item"
              style={{ color: "var(--fg)" }}
              onClick={() => {
                navigate("fiche-client", { clientId: c.id });
                setOpen(false);
                setQ("");
              }}
            >
              <span className="ic">
                <Icon name="user" size={16} />
              </span>
              <span className="label">
                {c.nom} <span style={{ color: "var(--muted)" }}>· client</span>
              </span>
            </button>
          ))}
          {results.vehicles.map((v) => (
            <button
              key={v.id}
              className="nav-item"
              style={{ color: "var(--fg)" }}
              onClick={() => {
                navigate("fiche-vehicule", { vehicleId: v.id });
                setOpen(false);
                setQ("");
              }}
            >
              <span className="ic">
                <Icon name="car" size={16} />
              </span>
              <span className="label">
                {v.plaque} · {v.marque} {v.modele}
              </span>
            </button>
          ))}
          {results.invoices.map((i) => (
            <button
              key={i.id}
              className="nav-item"
              style={{ color: "var(--fg)" }}
              onClick={() => {
                navigate("creances", { highlight: i.id });
                setOpen(false);
                setQ("");
              }}
            >
              <span className="ic">
                <Icon name="fileText" size={16} />
              </span>
              <span className="label">
                {i.numero} · {fcfa(i.resteDue)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar({ theme, setTheme, counts }) {
  const { data, currentUser, setRole, logout } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <header className="topbar">
      <div className="topbar-garage">{data.garage.nom}</div>
      <GlobalSearch />
      <div className="topbar-actions">
        <div className="theme-toggle">
          <Tip text="Thème clair">
            <button
              className={theme === "light" ? "active" : ""}
              onClick={() => setTheme("light")}
              aria-label="Thème clair"
            >
              <Icon name="sun" size={15} />
            </button>
          </Tip>
          <Tip text="Thème sombre">
            <button
              className={theme === "dark" ? "active" : ""}
              onClick={() => setTheme("dark")}
              aria-label="Thème sombre"
            >
              <Icon name="moon" size={15} />
            </button>
          </Tip>
        </div>
        <Tip text="Notifications">
          <button className="icon-btn" aria-label="Notifications">
            <Icon name="bell" size={18} />
            {counts.relances > 0 && <span className="dot" />}
          </button>
        </Tip>
        <div style={{ position: "relative" }} ref={ref}>
          <div className="avatar" onClick={() => setMenuOpen(!menuOpen)} title={currentUser.nom}>
            {currentUser.avatar}
          </div>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 8px)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                boxShadow: "var(--shadow-md)",
                width: 230,
                zIndex: 60,
                padding: 8,
              }}
            >
              <div
                style={{
                  padding: "8px 10px 10px",
                  borderBottom: "1px solid var(--border)",
                  marginBottom: 6,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currentUser.nom}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{currentUser.role}</div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  padding: "4px 10px",
                  fontWeight: 700,
                }}
              >
                Changer de rôle (démo)
              </div>
              {data.users.map((u) => (
                <button
                  key={u.id}
                  className="nav-item"
                  style={{ color: "var(--fg)", minHeight: 38 }}
                  onClick={() => {
                    setRole(u.id);
                    setMenuOpen(false);
                  }}
                >
                  <span className="ic">
                    <Icon name="user" size={15} />
                  </span>
                  <span className="label">
                    {u.nom} — {u.role}
                  </span>
                </button>
              ))}
              <hr className="sep" style={{ margin: "6px 0" }} />
              <button
                className="nav-item"
                style={{ color: "var(--status-bad)", minHeight: 38 }}
                onClick={logout}
              >
                <span className="ic">
                  <Icon name="logout" size={15} />
                </span>
                <span className="label">Déconnexion</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

Object.assign(window, {
  Icon,
  Tip,
  StatusPill,
  TypePill,
  ChanPill,
  PalierBadge,
  KpiCard,
  Countdown,
  KmProgress,
  AlertBanner,
  AlertList,
  Modal,
  ToastHost,
  EmptyState,
  Skeleton,
  SkeletonCard,
  Pagination,
  SortTh,
  sortRows,
  paginate,
  VariableChip,
  VARIABLES,
  MessagePreview,
  AppContext,
  useApp,
  Sidebar,
  BottomTabBar,
  PlusSheet,
  TopBar,
  NAV_PRIMARY,
  NAV_MORE,
  ALL_NAV,
});
