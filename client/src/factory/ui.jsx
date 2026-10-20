import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { FiX, FiInfo, FiCamera, FiCheck, FiMessageCircle, FiRefreshCw, FiMapPin, FiLink } from "react-icons/fi";
import { fapi } from "./fapi.js";

// ============================================================
// موج للمصانع — قطع مشتركة بين الشاشات
// ============================================================

export const FxContext = createContext(null);
export const useFx = () => useContext(FxContext);

export const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n) => Number(n || 0).toLocaleString("en-US");
export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("ar-JO-u-nu-latn", { hour: "numeric", minute: "2-digit" }) : "");
export const date = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("ar-JO-u-nu-latn", { weekday: "short", day: "numeric", month: "numeric" }) : "");
export const dateTime = (iso) => (iso ? `${date(iso)} ${time(iso)}` : "");
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

export const ORDER_STATUS = {
  new: ["جديد", "sky"],
  assigned: ["على سيارة", "sky"],
  onway: ["بالطريق", "ok"],
  delivered: ["مسلّم", "ok"],
  failed: ["ما تسلّم", "crit"],
  delayed: ["مؤجل", "warn"],
  cancelled: ["ملغي", ""],
};
export const TRIP_STATUS = {
  planned: ["لسا ما طلعت", "sky"],
  active: ["بالطريق", "ok"],
  returned: ["رجعت للمصنع", "warn"],
  closed: ["مسكّرة", ""],
  cancelled: ["ملغية", ""],
};
export function StatusPill({ map, value }) {
  const [label, tone] = map[value] || [value, ""];
  return <span className={`fx-pill ${tone}`}>{label}</span>;
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fx-sheet-wrap">
      <div className="fx-scrim" onClick={onClose} />
      <div className="fx-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="fx-grab" />
        <div className="fx-sheet-h">
          <h3>{title}</h3>
          <button className="fx-icon-btn" onClick={onClose} aria-label="إغلاق"><FiX /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// شرح قصير بأول مرة بيفتح فيها الشاشة
// الشروحات الزرقا انشالت من كل الشاشات (كانت زحمة كلام) — الشرح صار بزر «المساعد» بس
export function Tip() {
  return null;
}

export function OldTip({ id, children }) {
  const key = `fx-tip-${id}`;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });
  if (hidden) return null;
  return (
    <div className="fx-tip" role="note">
      <FiInfo aria-hidden="true" />
      <span>{children}</span>
      <button className="fx-link" onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* تجاهل */ } setHidden(true); }}>فهمت</button>
    </div>
  );
}

export function Empty({ icon: Icon, title, text, children }) {
  return (
    <div className="fx-empty">
      {Icon && <Icon aria-hidden="true" />}
      <b>{title}</b>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

export function Err({ msg }) {
  return msg ? <div className="fx-err" role="alert">{msg}</div> : null;
}

export function Loading() {
  return <p className="fx-muted">جاري التحميل...</p>;
}

// تحميل بيانات مع إعادة المحاولة
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fn());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

// زر بيعمل إجراء وبيمنع الضغط المكرر
export function Act({ onClick, children, className = "fx-btn", disabled, ...rest }) {
  const [busy, setBusy] = useState(false);
  const fx = useFx();
  return (
    <button
      {...rest}
      className={className}
      disabled={disabled || busy}
      onClick={async (e) => {
        setBusy(true);
        try {
          await onClick?.(e);
        } catch (err) {
          fx?.toast(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "لحظة..." : children}
    </button>
  );
}

// صورة من الكاميرا مباشرة (مش من المعرض) ورفعها
export function PhotoInput({ label, hint, value, onChange, kind = "f" }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const fx = useFx();
  return (
    <button type="button" className={`fx-step ${value ? "on" : ""}`} onClick={() => ref.current?.click()} disabled={busy}>
      <span className="fx-check">{value ? <FiCheck /> : null}</span>
      <span className="t">
        <b>{label}</b>
        <small>{busy ? "عم بنرفع الصورة..." : value ? "تم التصوير" : hint || "اكبس عشان تصوّر"}</small>
      </span>
      {value ? <img className="fx-photo" src={value} alt="" /> : <FiCamera aria-hidden="true" style={{ width: 22, height: 22, color: "var(--fx-muted)" }} />}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const r = await fapi.upload(f, kind);
            onChange(r.url);
          } catch (err) {
            fx?.toast(err.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </button>
  );
}

// توقيع الزبون بإصبعه
export function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#10304d";
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height];
    };
    const down = (e) => { drawing.current = true; cv.setPointerCapture(e.pointerId); const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const move = (e) => { if (!drawing.current) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); };
    const up = () => {
      if (!drawing.current) return;
      drawing.current = false;
      setSigned(true);
      onChange(cv.toDataURL("image/png"));
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
    };
  }, [onChange]);
  return (
    <div className="fx-field">
      توقيع الزبون
      <canvas ref={ref} className="fx-sig" width={600} height={240} />
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <small className="fx-muted">{signed ? "تم التوقيع" : "خلي الزبون يوقّع بإصبعه هون"}</small>
        <button type="button" className="fx-link" onClick={() => { const cv = ref.current; cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); setSigned(false); onChange(null); }}>امسح</button>
      </div>
    </div>
  );
}

export function getLocation(timeout = 8000, maxAge = 60000) {
  const once = (opts) => new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      opts
    );
  });
  if (!navigator.geolocation) return Promise.resolve(null);
  // بالأول GPS دقيق؛ إذا ما لقط (جوا محل مثلًا) بنرضى بآخر موقع معروف من الشبكة
  return once({ enableHighAccuracy: true, timeout, maximumAge: maxAge })
    .then((r) => r || once({ enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }));
}

// تثبيت موقع: «أنا هون هلأ» أو لصق رابط خرائط جوجل / واتساب
export function LocationPicker({ lat, lng, onChange, hereLabel = "أنا هون هلأ — خذ موقعي", title = "الموقع", hl, bare = false }) {
  const fx = useFx();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const has = lat !== "" && lat != null && lng !== "" && lng != null;
  async function fromLink(raw) {
    const url = String(raw || "").trim().match(/https?:\/\/\S+/)?.[0];
    if (!url) return fx.toast("الصق رابط خرائط جوجل (بيبلّش بـ https://)");
    setBusy("link");
    try {
      const p = await fapi.resolveMapLink(url);
      await onChange({ lat: p.lat, lng: p.lng, maps_url: url });
      setLink("");
    } catch (e) { fx.toast(e.message); } finally { setBusy(""); }
  }
  async function here() {
    setBusy("gps");
    const loc = await getLocation(12000, 0);
    if (!loc) { setBusy(""); return fx.toast("ما قدرنا نجيب الموقع — شغّل الموقع (GPS) بالتلفون."); }
    try { await onChange({ ...loc, maps_url: `https://www.google.com/maps?q=${loc.lat},${loc.lng}` }); } finally { setBusy(""); }
  }
  const status = has
    ? <span className="fx-row" style={{ gap: 6 }}>
        <a className="fx-pill ok" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer"><FiCheck /> الموقع محفوظ — شوفه</a>
        <button type="button" className="fx-icon-btn sm" aria-label="امسح الموقع" onClick={() => onChange({ lat: "", lng: "", maps_url: "" })}><FiX /></button>
      </span>
    : <span className="fx-pill warn">لسا بدون موقع</span>;
  const body = (
    <>
      <button type="button" className={`fx-btn ${bare ? "pri fx-big" : "sky"} block`} onClick={here} disabled={!!busy}><FiMapPin /> {busy === "gps" ? "عم بنجيب موقعك..." : hereLabel}</button>
      <div className="fx-iconfield">
        <FiLink aria-hidden="true" />
        <input className="fx-input" value={link} onChange={(e) => setLink(e.target.value)}
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/https?:\/\//.test(t)) { e.preventDefault(); setLink(t); fromLink(t); } }}
          placeholder="أو الصق رابط الموقع (اختياري)" />
        {link.trim() && <button type="button" className="fx-btn sm" disabled={!!busy} onClick={() => fromLink(link)}>{busy === "link" ? "..." : "ثبّت"}</button>}
      </div>
    </>
  );
  if (bare) return <div className="fx-stack" data-hl={hl}>{body}<div>{status}</div></div>;
  return (
    <div className="fx-card fx-stack fx-locbox" data-hl={hl}>
      <div className="fx-row" style={{ justifyContent: "space-between" }}><b>{title}</b>{status}</div>
      {body}
      <small className="fx-muted">الرابط من خرائط جوجل: افتح المكان ← مشاركة ← نسخ الرابط. أو أي رابط موقع وصلك على واتساب.</small>
    </div>
  );
}

export function waNumber(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("962")) return d;
  if (d.startsWith("0")) return `962${d.slice(1)}`;
  return `962${d}`;
}
export function waLink(phone, text) {
  const n = waNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text || "")}`;
}

// قائمة رسائل الزباين اللي لازم تنبعت — كل وحدة بزر واتساب
export function SendMessages({ ids, title = "بلّغ الزباين", onClose }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ids?.length) return;
    fapi.messages({ ids: ids.join(",") }).then(setList).catch((e) => setError(e.message));
  }, [ids?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ids?.length) return null;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="fx-stack">
        <p className="fx-muted" style={{ margin: 0 }}>كل رسالة جاهزة. اكبس «ابعت» وبتفتح على واتساب الزبون والرسالة مكتوبة.</p>
        <Err msg={error} />
        {!list && !error && <Loading />}
        {list?.map((m) => <MessageRow key={m.id} m={m} onSent={() => setList((l) => l.map((x) => (x.id === m.id ? { ...x, sent_at: new Date().toISOString() } : x)))} />)}
        <button className="fx-btn block" onClick={onClose}>خلص</button>
      </div>
    </Sheet>
  );
}

export function MessageRow({ m, onSent }) {
  return (
    <div className="fx-card" style={{ display: "grid", gap: 8 }}>
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <b>{m.customer_name}</b>
        {m.sent_at ? <span className="fx-pill ok">انبعتت</span> : <span className="fx-pill warn">لسا</span>}
      </div>
      <p style={{ margin: 0, whiteSpace: "pre-line", fontSize: 13.5, color: "var(--fx-muted)" }}>{m.body}</p>
      {m.phone ? (
        <a
          className="fx-btn wa"
          href={waLink(m.phone, m.body)}
          target="_blank"
          rel="noreferrer"
          onClick={() => { fapi.messageSent(m.id).catch(() => {}); onSent?.(); }}
        >
          <FiMessageCircle /> {m.sent_at ? "ابعتها مرة ثانية" : "ابعت على واتساب"}
        </a>
      ) : (
        <span className="fx-note warn">ما في رقم تلفون للزبون.</span>
      )}
    </div>
  );
}

export function Reload({ onClick }) {
  return <button className="fx-icon-btn" onClick={onClick} aria-label="تحديث"><FiRefreshCw /></button>;
}

// البونص المتوقع حسب القواعد (نفس حساب السيرفر — للعرض قبل الحفظ)
export function bonusPreview(rules, customerId, productId, qty) {
  const q = Number(qty) || 0;
  if (!q || !rules?.length) return 0;
  const fits = rules.filter((r) => r.active && (!r.customer_id || r.customer_id === customerId) && (!r.product_id || r.product_id === productId));
  if (!fits.length) return 0;
  const rank = (r) => (r.customer_id ? 2 : 0) + (r.product_id ? 1 : 0);
  const best = fits.sort((a, b) => rank(b) - rank(a) || b.id - a.id)[0];
  return Math.floor(q / best.every_qty) * best.bonus_qty;
}

// صورة المنتج، وإذا ما إلها صورة: رسمة بسيطة (كاسة أو عبوة) بألوان المصنع
export function ProductArt({ p, size = 56 }) {
  if (p?.image_url) return <img src={p.image_url} alt={p.name} className="fx-prod-img" style={{ width: size, height: size }} />;
  const cup = /كاس|كوب/.test(p?.name || "");
  const label = (String(p?.name || "").match(/\d+/) || [""])[0];
  return (
    <svg className="fx-prod-img" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={p?.name}>
      <rect width="64" height="64" rx="16" fill="#E6F5FD" />
      {cup ? (
        <g>
          <path d="M18 20h28l-3.5 30a3 3 0 0 1-3 2.6H24.5a3 3 0 0 1-3-2.6z" fill="#fff" stroke="#13A7EC" strokeWidth="2.4" />
          <path d="M20.4 32h23.2l-1.9 17.4a2 2 0 0 1-2 1.8H24.3a2 2 0 0 1-2-1.8z" fill="#13A7EC" opacity=".35" />
          <rect x="16" y="15" width="32" height="6" rx="3" fill="#0456A2" />
        </g>
      ) : (
        <g>
          <rect x="27" y="8" width="10" height="6" rx="2" fill="#0456A2" />
          <path d="M26 14h12v4c4 2 6 5 6 9v24a5 5 0 0 1-5 5H25a5 5 0 0 1-5-5V27c0-4 2-7 6-9z" fill="#fff" stroke="#13A7EC" strokeWidth="2.4" />
          <path d="M22 34h20v17a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3z" fill="#13A7EC" opacity=".35" />
        </g>
      )}
      {label && <text x="32" y={cup ? 44 : 46} textAnchor="middle" fontSize="9" fontWeight="700" fill="#0456A2" fontFamily="system-ui">{label}</text>}
    </svg>
  );
}

export function HBar({ label, value, max, tone = "", suffix = "" }) {
  return (
    <div className="fx-hbar">
      <span>{label}</span>
      <b>{num(value)}{suffix}</b>
      <div className={`fx-bar ${tone}`}><i style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>
    </div>
  );
}
