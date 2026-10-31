import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { FiX, FiInfo, FiCamera, FiCheck, FiMessageCircle, FiRefreshCw, FiMapPin, FiLink, FiEdit3 } from "react-icons/fi";
import { createPortal } from "react-dom";
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
  // زر الرجوع بالتلفون بيسكّر الشاشة المفتوحة خطوة خطوة (مش بيطلع من الصفحة كلها)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && closeRef.current?.();
    window.addEventListener("keydown", onKey);
    const depth = (window.history.state?.fxDepth || 0) + 1;
    let poppedByBack = false;
    try { window.history.pushState({ ...(window.history.state || {}), fxDepth: depth }, ""); } catch { /* */ }
    const onPop = (e) => {
      if ((e.state?.fxDepth || 0) < depth) { poppedByBack = true; closeRef.current?.(); }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      // تسكّرت بزر ✕ أو بعد الحفظ؟ بنشيل خطوتها من تاريخ الرجوع (إلا إذا التطبيق انتقل لصفحة ثانية)
      if (!poppedByBack && window.history.state?.fxDepth === depth) { try { window.history.back(); } catch { /* */ } }
    };
  }, []);
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
  const lock = useRef(false); // كبستين ورا بعض بسرعة (قبل ما الزر ينطفي) = وحدة بس
  const fx = useFx();
  return (
    <button
      {...rest}
      className={className}
      disabled={disabled || busy}
      onClick={async (e) => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        try {
          await onClick?.(e);
        } catch (err) {
          fx?.toast(err.message);
        } finally {
          lock.current = false;
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
// التوقيع: زر بيفتح شاشة كاملة بالعرض — لفّ التلفون ووقّع براحتك، والتوقيع بيرجع معدول على الفاتورة
export function SignaturePad({ onChange, label = "توقيع الزبون", hint = "اضغط وخلي الزبون يوقّع" }) {
  const [img, setImg] = useState(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="fx-field">
      {label}
      {img ? (
        <div className="fx-sig-done">
          <img src={img} alt="التوقيع" />
          <div className="fx-row" style={{ justifyContent: "space-between" }}>
            <span className="fx-pill ok"><FiCheck /> تم التوقيع</span>
            <span className="fx-row" style={{ gap: 14 }}>
              <button type="button" className="fx-link" onClick={() => setOpen(true)}>وقّع من جديد</button>
              <button type="button" className="fx-link" onClick={() => { setImg(null); onChange(null); }}>امسح</button>
            </span>
          </div>
        </div>
      ) : (
        <button type="button" className="fx-sig-btn" onClick={() => setOpen(true)}>
          <FiEdit3 aria-hidden="true" />
          <b>اضغط للتوقيع</b>
          <small>{hint}</small>
        </button>
      )}
      {open && (
        <SignScreen
          title={label}
          onCancel={() => setOpen(false)}
          onDone={(data) => { setImg(data); onChange(data); setOpen(false); }}
        />
      )}
    </div>
  );
}

// شاشة التوقيع الكاملة: إذا التلفون واقف بنلف الشاشة 90° عشان توقّع بالعرض
function SignScreen({ title, onCancel, onDone }) {
  const portraitQ = () => window.matchMedia?.("(orientation: portrait)").matches ?? window.innerHeight > window.innerWidth;
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight, portrait: portraitQ() }));
  const [has, setHas] = useState(false);
  const cvRef = useRef(null);
  const st = useRef({ drawing: false, pts: [], box: null });

  useEffect(() => {
    const onR = () => setVp({ w: window.innerWidth, h: window.innerHeight, portrait: portraitQ() });
    window.addEventListener("resize", onR);
    window.addEventListener("orientationchange", onR);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const back = () => onCancel();
    history.pushState({ ...(history.state || {}), fxSign: 1 }, "");
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("resize", onR);
      window.removeEventListener("orientationchange", onR);
      window.removeEventListener("popstate", back);
      document.body.style.overflow = prev;
      if (history.state?.fxSign) history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rot = vp.portrait;                 // بنلف الشاشة؟
  const W = rot ? vp.h : vp.w;             // عرض «ورقة» التوقيع
  const H = rot ? vp.w : vp.h;
  const padH = 64, foot = 76;              // شريط فوق وتحت
  const cw = W - 24, ch = Math.max(120, H - padH - foot);

  // تجهيز اللوحة كل ما تغيّر الحجم (بتنمسح — طبيعي لما تلف التلفون)
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#10304d";
    ctx.lineWidth = 3.6;
    st.current = { drawing: false, pts: [], box: null };
    setHas(false);
  }, [cw, ch]);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    // من نقطة على الشاشة لنقطة على اللوحة (مع حساب اللفّة)
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      return rot ? [sy, r.width - sx] : [sx, sy];
    };
    const grow = (x, y) => {
      const b = st.current.box || { x0: x, y0: y, x1: x, y1: y };
      st.current.box = { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) };
    };
    const down = (e) => {
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      const [x, y] = pt(e);
      st.current.drawing = true;
      st.current.pts = [[x, y]];
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fillStyle = "#10304d"; ctx.fill();
      grow(x, y);
    };
    const move = (e) => {
      if (!st.current.drawing) return;
      e.preventDefault();
      const [x, y] = pt(e);
      const p = st.current.pts;
      const [lx, ly] = p[p.length - 1];
      const mx = (lx + x) / 2, my = (ly + y) / 2;
      ctx.beginPath();
      if (p.length > 1) { const [px, py] = p[p.length - 2]; ctx.moveTo((px + lx) / 2, (py + ly) / 2); } else ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(lx, ly, mx, my);
      ctx.stroke();
      p.push([x, y]);
      grow(x, y);
    };
    const up = () => {
      if (!st.current.drawing) return;
      st.current.drawing = false;
      setHas(true);
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
    };
  }, [rot, cw, ch]);

  function clear() {
    const cv = cvRef.current;
    const ctx = cv.getContext("2d");
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore();
    st.current = { drawing: false, pts: [], box: null };
    setHas(false);
  }

  // بنقص التوقيع على قدّه وبنصغّره — صورة خفيفة ومعدولة
  function done() {
    const cv = cvRef.current;
    const b = st.current.box;
    if (!b) return;
    const dpr = cv.width / cw;
    const pad = 14;
    const x0 = Math.max(0, (b.x0 - pad) * dpr), y0 = Math.max(0, (b.y0 - pad) * dpr);
    const x1 = Math.min(cv.width, (b.x1 + pad) * dpr), y1 = Math.min(cv.height, (b.y1 + pad) * dpr);
    const sw = Math.max(1, x1 - x0), sh = Math.max(1, y1 - y0);
    let maxW = 700, data = "";
    for (let i = 0; i < 4; i++) {
      const k = Math.min(1, maxW / sw, 300 / sh);
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(sw * k));
      out.height = Math.max(1, Math.round(sh * k));
      out.getContext("2d").drawImage(cv, x0, y0, sw, sh, 0, 0, out.width, out.height);
      data = out.toDataURL("image/png");
      if (data.length < 150000) break;
      maxW = Math.round(maxW * 0.7);
    }
    onDone(data);
  }

  const stage = rot
    ? { width: W, height: H, transform: `translate(${vp.w}px, 0) rotate(90deg)`, transformOrigin: "0 0" }
    : { width: W, height: H };
  return createPortal(
    <div className="fx-signscreen" dir="rtl">
      <div className="fx-signstage" style={stage}>
        <div className="fx-sign-top" style={{ height: padH }}>
          <b>{title}</b>
          <small>{rot ? "لفّ التلفون بالعرض ووقّع" : "وقّع بإصبعك على الخط"}</small>
        </div>
        <div className="fx-sign-pad" style={{ width: cw, height: ch }}>
          <canvas ref={cvRef} style={{ width: cw, height: ch }} />
          {!has && <span className="fx-sign-ghost">وقّع هون</span>}
          <i className="fx-sign-line" aria-hidden="true" />
        </div>
        <div className="fx-sign-foot" style={{ height: foot }}>
          <button type="button" className="fx-sign-b ghost" onClick={onCancel}>إلغاء</button>
          <button type="button" className="fx-sign-b soft" onClick={clear} disabled={!has}>امسح</button>
          <button type="button" className="fx-sign-b pri" onClick={done} disabled={!has}><FiCheck /> تم</button>
        </div>
      </div>
    </div>,
    document.body
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

// أي نص ملصوق فيه موقع: رابط (حتى لو معه اسم المحل والعنوان) أو إحداثيات «31.95, 35.91»
export function locText(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/https?:\/\/\S+/.test(s)) return s;
  return /-?\d{1,2}(\.\d+)?\s*[,،]\s*-?\d{1,3}(\.\d+)?/.test(s) ? s : "";
}
export function mapsUrlFor(t, p) {
  const url = String(t || "").match(/https?:\/\/[^\s"'<>]+/)?.[0];
  return url || `https://www.google.com/maps?q=${p.lat},${p.lng}`;
}
// قراءة المنسوخ بكبسة وحدة (الآيفون بيطلع «لصق» صغيرة توافق عليها)
export async function readClipboard() {
  try { return (await navigator.clipboard?.readText?.()) || ""; } catch { return ""; }
}

// تثبيت موقع: «أنا هون هلأ» أو لصق رابط خرائط جوجل / واتساب
export function LocationPicker({ lat, lng, onChange, hereLabel = "أنا هون هلأ — خذ موقعي", title = "الموقع", hl, bare = false }) {
  const fx = useFx();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const has = lat !== "" && lat != null && lng !== "" && lng != null;
  async function fromLink(raw) {
    const t = locText(raw);
    if (!t) return fx.toast("الصق رابط الموقع من خرائط جوجل أو واتساب");
    setBusy("link");
    try {
      const p = await fapi.resolveMapLink(t);
      await onChange({ lat: p.lat, lng: p.lng, maps_url: mapsUrlFor(t, p) });
      setLink("");
    } catch (e) { fx.toast(e.message); } finally { setBusy(""); }
  }
  async function pasteNow() {
    const t = await readClipboard();
    if (locText(t)) { setLink(t); fromLink(t); } else fx.toast("ما في رابط موقع منسوخ — انسخ الرابط والصقه بالخانة");
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
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (locText(t)) { e.preventDefault(); setLink(t); fromLink(t); } }}
          placeholder="أو الصق رابط الموقع (اختياري)" />
        {link.trim()
          ? <button type="button" className="fx-btn sm" disabled={!!busy} onClick={() => fromLink(link)}>{busy === "link" ? "..." : "ثبّت"}</button>
          : <button type="button" className="fx-btn sm" disabled={!!busy} onClick={pasteNow}>{busy === "link" ? "..." : "الصق"}</button>}
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
// إرسال رسائل لأكثر من زبون: واحد ورا الثاني بكبسة — بتبعت، بترجع من واتساب، وبيجهّزلك اللي بعده لحاله
export function SendMessages({ ids, title = "بلّغ الزباين", onClose }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [cur, setCur] = useState(0);
  const [showText, setShowText] = useState(false);
  const away = useRef(false);
  useEffect(() => {
    if (!ids?.length) return;
    fapi.messages({ ids: ids.join(",") }).then((l) => { setList(l); setCur(Math.max(0, l.findIndex((m) => !m.sent_at && m.phone))); }).catch((e) => setError(e.message));
  }, [ids?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextFrom = (l, i) => { for (let k = 1; k <= l.length; k++) { const j = (i + k) % l.length; if (!l[j].sent_at && l[j].phone) return j; } return -1; };
  // رجعت من واتساب؟ بنروح للي بعده لحاله
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== "visible" || !away.current) return;
      away.current = false;
      setList((l) => { if (l) { const n = nextFrom(l, cur); if (n >= 0) setCur(n); } return l; });
      setShowText(false);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [cur]);
  if (!ids?.length) return null;
  const withPhone = list?.filter((m) => m.phone) || [];
  const sentN = withPhone.filter((m) => m.sent_at).length;
  const allDone = list && sentN === withPhone.length;
  const m = list?.[cur];
  const send = () => {
    fapi.messageSent(m.id).catch(() => {});
    setList((l) => l.map((x) => (x.id === m.id ? { ...x, sent_at: new Date().toISOString() } : x)));
    away.current = true;
  };
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="fx-stack">
        <Err msg={error} />
        {!list && !error && <Loading />}
        {list && (
          <>
            <div className="sm-prog">
              <div className="sm-bar"><i style={{ width: `${withPhone.length ? (sentN / withPhone.length) * 100 : 0}%` }} /></div>
              <small>انبعت {num(sentN)} من {num(withPhone.length)}</small>
            </div>
            {allDone ? (
              <div className="sm-done">
                <FiCheck aria-hidden="true" />
                <b>انبعتت لكل الزباين</b>
                <button className="fx-btn pri block" onClick={onClose}>تمام</button>
              </div>
            ) : m && (
              <div className="sm-card">
                <small>الزبون {num(withPhone.findIndex((x) => x.id === m.id) + 1)} من {num(withPhone.length)}</small>
                <b className="nm">{m.customer_name}</b>
                <button type="button" className="fx-link" onClick={() => setShowText(!showText)}>{showText ? "خبّي الرسالة" : "شوف الرسالة"}</button>
                {showText && <p className="txt">{m.body}</p>}
                {m.phone ? (
                  <a className="fx-btn wa block fx-huge" href={waLink(m.phone, m.body)} target="_blank" rel="noreferrer" onClick={send}>
                    <FiMessageCircle /> {m.sent_at ? "ابعتها مرة ثانية" : "ابعت على واتساب"}
                  </a>
                ) : <div className="fx-note warn">ما إله رقم تلفون.</div>}
                <div className="fx-row" style={{ justifyContent: "space-between" }}>
                  <button type="button" className="fx-link" onClick={() => { const n = nextFrom(list, cur); if (n >= 0) setCur(n); }}>تخطّاه ←</button>
                  {m.sent_at && <span className="fx-pill ok"><FiCheck /> انبعتت</span>}
                </div>
              </div>
            )}
            <div className="sm-list">
              {list.map((x, i) => (
                <button key={x.id} type="button" className={`sm-chip ${i === cur ? "on" : ""} ${x.sent_at ? "ok" : ""} ${!x.phone ? "no" : ""}`} onClick={() => setCur(i)} disabled={!x.phone}>
                  {x.sent_at ? <FiCheck aria-hidden="true" /> : null}{x.customer_name}
                </button>
              ))}
            </div>
            <small className="fx-muted">بعد ما تبعت ارجع للتطبيق، وبيطلعلك الزبون اللي بعده لحاله.</small>
            {!allDone && <button className="fx-btn block" onClick={onClose}>بعدين</button>}
          </>
        )}
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

// ============================================================
// إدخال تاريخ بالأرقام بدل التقويم الإنجليزي: سنة (٤ أرقام) ← شهر ← يوم
// بينقلك لحاله: الشهر «١» بيستنى (ممكن ١٠–١٢)، «٢»–«٩» بينقلك للأيام. وتحت بيكتب التاريخ بالعربي
// ============================================================
export const AR_MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
const AR_WEEK = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const toEn = (s) => String(s || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\D/g, "");
const pad2 = (s) => (s.length === 1 ? `0${s}` : s);
export function arDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${AR_WEEK[dt.getUTCDay()]} ${d} ${AR_MONTHS[m - 1]} ${y}`;
}

export function DateInput({ value, onChange, quick = false, ariaLabel = "التاريخ" }) {
  const parse = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v.split("-") : ["", "", ""]);
  const [[y, m, d], setParts] = useState(() => parse(value));
  const mRef = useRef(null), dRef = useRef(null), yRef = useRef(null);
  // لو القيمة تغيّرت من برّا
  useEffect(() => {
    const cur = y && m && d ? `${y}-${pad2(m)}-${pad2(d)}` : "";
    if ((value || "") !== cur && (value || cur)) setParts(parse(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = (yy, mm, dd) => {
    setParts([yy, mm, dd]);
    if (!yy && !mm && !dd) return onChange("");
    if (yy.length !== 4 || !mm || !dd) return;
    const M = Number(mm), D = Number(dd);
    const last = M >= 1 && M <= 12 ? new Date(Date.UTC(Number(yy), M, 0)).getUTCDate() : 0;
    if (M < 1 || M > 12 || D < 1 || D > last) return onChange(""); // تاريخ غلط ما بيمشي
    onChange(`${yy}-${pad2(mm)}-${pad2(dd)}`);
  };
  const onY = (e) => {
    const v = toEn(e.target.value).slice(0, 4);
    emit(v, m, d);
    if (v.length === 4) mRef.current?.focus();
  };
  const onM = (e) => {
    let v = toEn(e.target.value).slice(0, 2);
    if (v === "00") v = "0";
    if (v.length === 2 && Number(v) > 12) v = v[1] === "0" ? "1" : `0${v[1]}`;
    if (v.length === 1 && Number(v) > 1) { v = `0${v}`; }
    emit(y, v, d);
    if (v.length === 2) dRef.current?.focus();
  };
  const onD = (e) => {
    let v = toEn(e.target.value).slice(0, 2);
    if (v === "00") v = "0";
    if (v.length === 1 && Number(v) > 3) v = `0${v}`;
    if (v.length === 2 && Number(v) > 31) v = `0${v[1]}`;
    emit(y, m, v);
    if (v.length === 2) dRef.current?.blur();
  };
  const back = (prev) => (e) => { if (e.key === "Backspace" && !e.currentTarget.value) prev.current?.focus(); };
  const iso = y.length === 4 && m && d ? `${y}-${pad2(m)}-${pad2(d)}` : "";
  const ok = iso && value === iso;
  const Mn = Number(m), lastDay = y.length === 4 && Mn >= 1 && Mn <= 12 ? new Date(Date.UTC(Number(y), Mn, 0)).getUTCDate() : 31;
  const badDay = iso && !ok && Number(d) > lastDay;
  const set = (iso2) => { setParts(parse(iso2)); onChange(iso2); };
  const shift = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
  return (
    <div className="fx-date" role="group" aria-label={ariaLabel}>
      <div className="boxes">
        <label><small>السنة</small><input ref={yRef} className="fx-input" inputMode="numeric" dir="ltr" placeholder="2026" value={y} onChange={onY} onFocus={(e) => e.target.select()} /></label>
        <label><small>الشهر</small><input ref={mRef} className="fx-input" inputMode="numeric" dir="ltr" placeholder="١–١٢" value={m} onChange={onM} onKeyDown={back(yRef)} onFocus={(e) => e.target.select()} /></label>
        <label><small>اليوم</small><input ref={dRef} className="fx-input" inputMode="numeric" dir="ltr" placeholder="١–٣١" value={d} onChange={onD} onKeyDown={back(mRef)} onFocus={(e) => e.target.select()} /></label>
      </div>
      <small className={`said ${ok ? "ok" : badDay ? "bad" : (y || m || d) ? "wait" : ""}`}>
        {ok ? `📅 ${arDate(iso)}` : badDay ? `${AR_MONTHS[Mn - 1]} فيه ${lastDay} يوم بس` : m && Number(m) >= 1 && Number(m) <= 12 ? `شهر ${Number(m)} = ${AR_MONTHS[Number(m) - 1]}` : (y || m || d) ? "كمّل التاريخ" : ""}
      </small>
      {quick && (
        <div className="fx-chips">
          <button type="button" className="fx-chip" onClick={() => set(shift(0))}>اليوم</button>
          <button type="button" className="fx-chip" onClick={() => set(shift(1))}>بكرا</button>
          <button type="button" className="fx-chip" onClick={() => set(shift(2))}>بعد بكرا</button>
        </div>
      )}
    </div>
  );
}

// الزبون دفع بالكليك: المبلغ + صورة الوصل من تلفونه (بتوصل للمحاسب والإدارة)
export function CliqBox({ on, setOn, amount, setAmount, photo, setPhoto, max }) {
  return (
    <div className="fx-card fx-stack" style={{ gap: 8, padding: 12 }}>
      <label className="fx-row" style={{ gap: 8 }}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <b>📲 دفع بالكليك (حوالة)</b>
      </label>
      {on && (
        <>
          <label className="fx-field">قديش حوّل بالكليك؟{max ? <small className="fx-muted"> (من {money(max)})</small> : null}
            <input className="fx-input fx-num" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <PhotoInput label="صوّر وصل الكليك من تلفون الزبون" hint="لازم — بتوصل للمحاسب" value={photo} onChange={setPhoto} kind="cliq" />
          {Number(amount) > 0 && !photo && <small style={{ color: "var(--fx-crit)" }}>صوّر الوصل عشان تكمّل.</small>}
          <small className="fx-muted">مبلغ الكليك ما بينحسب على الكاش اللي معك.</small>
        </>
      )}
    </div>
  );
}

// موقع الزبون مش محفوظ: السائق لازم يحفظه (من مكانه عند الزبون) قبل الفاتورة
export function LocationGuard({ customerId, name, onSaved }) {
  const fx = useFx();
  const [busy, setBusy] = useState(false);
  return (
    <div className="fx-card fx-stack" style={{ gap: 8, background: "var(--fx-crit-soft)", border: "none" }}>
      <b style={{ color: "var(--fx-crit)" }}>📍 موقع {name || "الزبون"} مش محفوظ</b>
      <small>إنت هلأ عنده؟ احفظ موقعك كموقعه — بعدها بتقدر تعمل الفاتورة.</small>
      <button type="button" className="fx-btn pri block" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const loc = await getLocation(10000, 0);
          if (!loc) { fx.toast("شغّل الموقع (GPS) على التلفون وجرّب كمان مرة"); return; }
          await fapi.customerLocation(customerId, loc.lat, loc.lng);
          fx.toast("انحفظ موقع الزبون ✓");
          onSaved(loc);
        } catch (e) { fx.toast(e.message); } finally { setBusy(false); }
      }}>{busy ? "عم بنجيب موقعك..." : "📍 احفظ موقعي كموقع الزبون"}</button>
    </div>
  );
}
