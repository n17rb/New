import { useEffect, useRef, useState } from "react";
import { FiMapPin, FiLink, FiCheck } from "react-icons/fi";
import { api } from "../api.js";

// اختيار موقع الزبون: «موقعي الحالي» أو رابط خرائط — والمنطقة والمحافظة بيتعبّوا لحالهم
// value = { latitude, longitude, maps_url, region_id, region_name, governorate, street, building_number, floor, side }
export default function LocationPicker({ value, onChange, alwaysDetails = false, title = "موقع الزبون", optional = true }) {
  const [mode, setMode] = useState(null); // null | "link"
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [regions, setRegions] = useState([]);
  const v = value || {};
  const has = v.latitude != null && v.longitude != null;
  const detailsRef = useRef(null);
  const buildingRef = useRef(null);
  const wasSet = useRef(has);

  // أول ما ينحفظ الموقع: بنوديك مباشرة على تفاصيل البيت
  useEffect(() => {
    if (has && !wasSet.current) {
      setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        buildingRef.current?.focus({ preventScroll: true });
      }, 150);
    }
    wasSet.current = has;
  }, [has]);

  useEffect(() => { api.getRegions().then(setRegions).catch(() => {}); }, []);

  async function fill(body) {
    setBusy(true);
    setError("");
    try {
      const info = await api.placeInfo(body);
      onChange({ ...v, ...info, street: v.street || info.street || "" });
      setMode(null);
      setLink("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setError("الجهاز ما بيدعم تحديد الموقع.");
    setBusy(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => fill({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => { setBusy(false); setError(err.code === 1 ? "اسمح للتطبيق يوصل للموقع من إعدادات المتصفح." : "ما قدرت أحدد موقعك — جرّب كمان مرة أو الصق رابط."); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  const looksLikeLoc = (t) => /https?:\/\/|\d+\.\d+\s*[,،]\s*\d+\.\d+/.test(String(t || ""));
  function onPaste(text) {
    setLink(text);
    if (looksLikeLoc(text)) fill({ url: text.trim() });
  }
  // كبسة وحدة: إذا في رابط منسوخ بنثبّته فورا، وإلا بتفتح خانة اللصق
  async function pasteTap() {
    let t = "";
    try { t = (await navigator.clipboard?.readText?.()) || ""; } catch { /* المتصفح ما سمح */ }
    if (looksLikeLoc(t)) { setMode("link"); onPaste(t); } else setMode("link");
  }

  const set = (k) => (e) => onChange({ ...v, [k]: e.target.value });
  const regionKnown = v.region_id && regions.some((r) => r.id === v.region_id);

  // خانة بعنوان صغير فوقها (عشان لما تعدّل تعرف شو كل رقم)
  const F = (k, label, extra = {}) => (
    <label className="loc-field">
      <span>{label}</span>
      <input value={v[k] || ""} onChange={set(k)} placeholder={extra.placeholder || ""} ref={extra.ref} inputMode={extra.inputMode} />
    </label>
  );

  const houseDetails = (
    <div className="loc-details" ref={detailsRef}>
      <div className="loc-sub">تفاصيل البيت</div>
      <div className="loc-two">
        {F("building_number", "رقم العمارة", { ref: buildingRef })}
        {F("building_name", "اسم العمارة")}
      </div>
      <div className="loc-two">
        {F("floor", "الطابق")}
        {F("apartment", "رقم الشقة")}
      </div>
      <div className="side-btns">
        {[["يمين", "يمين الدرج"], ["يسار", "شمال الدرج"], ["يمين المصعد", "يمين المصعد"], ["شمال المصعد", "شمال المصعد"]].map(([val, label]) => (
          <button key={val} type="button" className={`side-btn${v.side === val ? " on" : ""}`}
            onClick={() => onChange({ ...v, side: v.side === val ? "" : val })}>
            {label}
          </button>
        ))}
      </div>
      {F("street", "الشارع")}
      {F("access_notes", "ملاحظة للوصول", { placeholder: "مثلًا: الجرس التاني، الباب الخلفي" })}
    </div>
  );

  return (
    <div className="loc-picker">
      <div className="loc-title"><FiMapPin /> {title} {optional && <span>(اختياري)</span>}</div>

      {!has && !mode && (
        <div className="loc-actions">
          <button type="button" className="loc-btn" disabled={busy} onClick={useMyLocation}>
            <FiMapPin /> {busy ? "جاري التحديد…" : "موقعي الحالي"}
          </button>
          <button type="button" className="loc-btn" disabled={busy} onClick={pasteTap}>
            <FiLink /> لصق رابط
          </button>
        </div>
      )}

      {!has && mode === "link" && (
        <div className="loc-link">
          <input
            autoFocus
            value={link}
            onChange={(e) => onPaste(e.target.value)}
            placeholder="الصق رابط خرائط جوجل هون"
            dir="ltr"
          />
          <div className="loc-link-row">
            <button type="button" className="link-btn" onClick={() => { setMode(null); setLink(""); setError(""); }}>رجوع</button>
            {link && !busy && <button type="button" className="link-btn" onClick={() => fill({ url: link.trim() })}>تحقق</button>}
            {busy && <span className="text-secondary" style={{ fontSize: "0.8rem" }}>جاري قراءة الرابط…</span>}
          </div>
        </div>
      )}

      {has && (
        <div className="loc-done">
          <div className="loc-done-row">
            <span className="loc-ok"><FiCheck /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="loc-done-t">{v.region_name || "تم تحديد الموقع"}</div>
              <div className="loc-done-s">{[v.governorate, v.street].filter(Boolean).join(" · ") || "الموقع محفوظ على الخريطة"}</div>
            </div>
            <button type="button" className="link-btn" onClick={() => onChange({ ...v, latitude: null, longitude: null, maps_url: null })}>تغيير</button>
          </div>

          <label className="loc-label">المنطقة</label>
          <select
            value={v.region_id ? String(v.region_id) : v.region_name ? `new:${v.region_name}` : ""}
            onChange={(e) => {
              const x = e.target.value;
              if (x.startsWith("new:")) onChange({ ...v, region_id: null, region_name: x.slice(4) });
              else {
                const r = regions.find((rr) => String(rr.id) === x);
                onChange({ ...v, region_id: r ? r.id : null, region_name: r ? r.name : "" });
              }
            }}
          >
            <option value="">بدون منطقة</option>
            {!regionKnown && v.region_name && <option value={`new:${v.region_name}`}>{v.region_name} (جديدة)</option>}
            {regions.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>

          {houseDetails}
        </div>
      )}

      {!has && alwaysDetails && <div style={{ marginTop: 10 }}>{houseDetails}</div>}

      {error && <div className="loc-error">{error}</div>}
    </div>
  );
}
