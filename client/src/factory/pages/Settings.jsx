import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiPlus, FiMapPin, FiUpload, FiChevronLeft, FiGift } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, Sheet, Tip, Err, Act, getLocation, ProductArt, money, num } from "../ui.jsx";

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const VSTATUS = { active: "شغالة", workshop: "بالصيانة", inactive: "موقفة" };

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tabs = [["brand", "المصنع"], ["products", "المنتجات"], ["vehicles", "السيارات"], ["lines", "الخطوط"], ["bonus", "البونص"], ["machines", "المكنات والمواد"]];
  const tab = tabs.find((t) => t[0] === params.get("tab"))?.[0] || "brand";
  return (
    <div className="fx-page">
      <h1 className="fx-h1">الإعدادات</h1>
      <div className="fx-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setParams({ tab: k })}>{l}</button>)}</div>
      {tab === "brand" && <Brand />}
      {tab === "products" && <Products />}
      {tab === "vehicles" && <Vehicles />}
      {tab === "lines" && <Lines />}
      {tab === "bonus" && <Bonus />}
      {tab === "machines" && <Machines />}
    </div>
  );
}

async function refresh(fx) {
  await fx.reloadBoot();
  fx.refreshMe?.();
}

export function Brand({ compact = false }) {
  const fx = useFx();
  const b = fx.boot.brand;
  const [name, setName] = useState(b.name || "");
  const [phone, setPhone] = useState(b.phone || "");
  const [tagline, setTagline] = useState(b.tagline || "");
  const [city, setCity] = useState(fx.boot.factory.city || "");
  const [ss, setSs] = useState(fx.boot.ss_rate);
  const fileRef = useRef(null);
  const iconRef = useRef(null);
  return (
    <div className="fx-stack">
      {!compact && <Tip id="brand">اسم المصنع وشعاره ورقمه بيطلعوا بالتطبيق وعلى الفواتير وبرسائل الزباين.</Tip>}
      <div className="fx-card fx-row">
        {b.logo ? <img src={b.logo} alt="الشعار" style={{ height: 52, maxWidth: 180, objectFit: "contain" }} /> : <span className="fx-avatar" style={{ width: 52, height: 52 }}>{(b.name || "م").charAt(0)}</span>}
        <span className="fx-grow" />
        <button className="fx-btn sky sm" onClick={() => fileRef.current?.click()}><FiUpload /> {b.logo ? "غيّر الشعار" : "ارفع الشعار"}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try { await fapi.uploadLogo(f); await refresh(fx); fx.toast("انحفظ الشعار"); } catch (err) { fx.toast(err.message); }
        }} />
      </div>
      <div className="fx-card fx-row">
        {b.icon ? <img src={b.icon} alt="الأيقونة" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", border: "1px solid var(--fx-line)" }} /> : <span className="fx-avatar" style={{ width: 52, height: 52 }}>{(b.name || "م").charAt(0)}</span>}
        <span className="fx-grow" style={{ display: "grid" }}><b style={{ fontSize: 14 }}>أيقونة التطبيق</b><small className="fx-muted">بتطلع على الشاشة الرئيسية لما الموظف يضيف التطبيق. الأحسن صورة مربعة.</small></span>
        <button className="fx-btn sky sm" onClick={() => iconRef.current?.click()}><FiUpload /> غيّر</button>
        <input ref={iconRef} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try { await fapi.uploadIcon(f); await refresh(fx); fx.toast("انحفظت الأيقونة"); } catch (err) { fx.toast(err.message); }
        }} />
      </div>
      <label className="fx-field">اسم المصنع<input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="fx-grid2">
        <label className="fx-field">رقم المصنع<input className="fx-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="fx-field">جملة تحت الاسم<input className="fx-input" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="للمياه الصحية" /></label>
      </div>
      <div className="fx-field">موقع المصنع (منه بتبلش الرحلات)
        <div className="fx-row">
          <input className="fx-input fx-grow" list="fx-cities2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="المدينة" />
          <datalist id="fx-cities2">{fx.boot.cities.map((x) => <option key={x} value={x} />)}</datalist>
          <Act className="fx-btn sky sm" onClick={async () => {
            const loc = await getLocation();
            if (!loc) return fx.toast("شغّل الموقع (GPS) بالتلفون وجرّب.");
            await fapi.saveSettings({ lat: loc.lat, lng: loc.lng });
            await refresh(fx);
            fx.toast("انحفظ موقع المصنع");
          }}><FiMapPin /> أنا بالمصنع هلأ</Act>
        </div>
        {fx.boot.factory.has_location ? <small style={{ color: "var(--fx-ok)" }}>موقع المصنع محفوظ</small> : <small>إذا ما حفظت الموقع، منحسب من المدينة.</small>}
      </div>
      {!compact && <label className="fx-field">نسبة الضمان الاجتماعي على الموظف (%)<input className="fx-input" type="number" inputMode="decimal" value={ss} onChange={(e) => setSs(e.target.value)} /></label>}
      <Act className="fx-btn pri block" onClick={async () => {
        await fapi.saveSettings({ brand_name: name, brand_phone: phone, brand_tagline: tagline, factory_city: city, ...(compact ? {} : { ss_employee_rate: ss }) });
        await refresh(fx);
        fx.toast("انحفظ");
      }}>احفظ</Act>
      {!compact && fx.isOwner && <SampleCard />}
    </div>
  );
}

// حذف الداتا التجريبية والبداية من جديد
export function SampleCard() {
  const fx = useFx();
  const [info, setInfo] = useState(null);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(null);
  useEffect(() => { fapi.sampleInfo().then(setInfo).catch(() => {}); }, [done]);
  if (!info || (!info.customers && !info.employees && !done)) return null;
  return (
    <div className="fx-card fx-stack" id="sample" data-hl="sample-card" style={{ borderColor: "var(--fx-warn)" }}>
      <b>الداتا التجريبية</b>
      {done ? (
        <div className="fx-note ok">انمسحت: {done.customers} زبون، {done.orders} طلب، {done.employees} موظف تجريبي. المصنع جاهز يبلش بزباينه الحقيقيين.</div>
      ) : info.is_demo ? (
        <div className="fx-note warn">هاي نسخة عرض وبترجع لأولها كل يوم. اطلب من موج يحوّل الحساب لحساب حقيقي، وبعدين امسح التجريبي من هون.</div>
      ) : (
        <>
          <span className="fx-muted">فيه {info.customers} زبون تجريبي و{info.orders} طلب و{info.employees} موظف تجريبي.</span>
          <div className="fx-card soft" style={{ fontSize: 13.5 }}>
            <b>بينمسح:</b> الزباين التجريبيين وطلباتهم وحساباتهم، والرحلات تبعتهم، وأرصدة المستودع والمواد الخام الوهمية، والموظفين التجريبيين (حساباتهم بتنطفي)، والتنبيهات.<br />
            <b>بيضل:</b> المنتجات وصورها، السيارات، الخطوط، المكنات، المواد الخام (برصيد صفر)، البونص، الشعار{info.real_customers ? `، و${info.real_customers} زبون حقيقي ضفتهم` : ""}.
          </div>
          <label className="fx-field">اكتب «امسح» للتأكيد<input className="fx-input" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          <Act className="fx-btn danger block" disabled={typed.trim() !== "امسح"} onClick={async () => {
            const r = await fapi.clearSample();
            setDone(r);
            await refresh(fx);
            fx.toast("انمسحت الداتا التجريبية");
          }}>امسح التجريبي وابدأ من جديد</Act>
          <span className="fx-muted" style={{ fontSize: 12.5 }}>بعدها: عدّل السيارات واربطها بسائقينك، اعمل حسابات موظفينك، وضيف زباينك. معالج البداية بيرجع يمشّيك.</span>
        </>
      )}
    </div>
  );
}

export function Products() {
  const fx = useFx();
  const [edit, setEdit] = useState(null);
  return (
    <div className="fx-stack">
      <Tip id="products">كل منتج: الاسم، كم حبة بالكرتونة، وسعر الكرتونة. سعر الزبون الخاص بتحطه من بطاقة الزبون.</Tip>
      <button className="fx-btn pri" onClick={() => setEdit({})}><FiPlus /> منتج جديد</button>
      <div className="fx-list">
        {fx.boot.products.length === 0 && <div className="fx-item"><span className="fx-muted">ما في منتجات لسا.</span></div>}
        {fx.boot.products.map((p) => (
          <button key={p.id} className="fx-item" onClick={() => setEdit(p)}>
            <ProductArt p={p} size={48} />
            <span className="t"><b>{p.name}{!p.active ? " (موقوف)" : ""}</b><span>{p.per_carton ? `${p.per_carton} حبة بالكرتونة · ` : ""}{money(p.price)} د.أ للكرتونة{p.min_stock ? ` · الحد الأدنى ${num(p.min_stock)}` : ""}</span></span>
            <FiChevronLeft style={{ color: "var(--fx-muted)" }} />
          </button>
        ))}
      </div>
      {edit && <ProductSheet p={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ProductSheet({ p, onClose }) {
  const fx = useFx();
  const [f, setF] = useState({ name: p.name || "", per_carton: p.per_carton || "", price: p.price ?? "", min_stock: p.min_stock || "", active: p.active !== false, sort_order: p.sort_order || 0 });
  const [recipe, setRecipe] = useState(() => Object.fromEntries((p.recipe || []).map((r) => [r.material_id, r.qty])));
  const [err, setErr] = useState("");
  const [img, setImg] = useState(p.image_url || null);
  const [file, setFile] = useState(null);
  const imgRef = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title={p.id ? p.name : "منتج جديد"} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-row">
          <ProductArt p={{ name: f.name, image_url: img }} size={84} />
          <div className="fx-stack" style={{ gap: 6 }}>
            <button type="button" className="fx-btn sky sm" onClick={() => imgRef.current?.click()}><FiUpload /> {img ? "غيّر الصورة" : "ارفع صورة المنتج"}</button>
            {img && <button type="button" className="fx-link" onClick={() => { setImg(null); setFile("remove"); }}>شيل الصورة</button>}
            <small className="fx-muted">الصورة بتطلع للموظف وهو بيسجّل الطلب.</small>
          </div>
          <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) { setFile(x); setImg(URL.createObjectURL(x)); } }} />
        </div>
        <label className="fx-field">الاسم<input className="fx-input" value={f.name} onChange={set("name")} placeholder="مثلًا: شرنك 600 مل" /></label>
        <div className="fx-grid2">
          <label className="fx-field">حبة بالكرتونة<input className="fx-input" type="number" inputMode="numeric" value={f.per_carton} onChange={set("per_carton")} /></label>
          <label className="fx-field">سعر الكرتونة (د.أ)<input className="fx-input" type="number" inputMode="decimal" value={f.price} onChange={set("price")} /></label>
        </div>
        <label className="fx-field">الحد الأدنى بالمستودع (تنبيه)<input className="fx-input" type="number" inputMode="numeric" value={f.min_stock} onChange={set("min_stock")} /></label>
        {p.id && <label className="fx-row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> المنتج شغال</label>}
        {fx.boot.materials.length > 0 && (
          <details>
            <summary className="fx-link">المواد الخام لكل كرتونة (بتنخصم لحالها مع الإنتاج)</summary>
            <div className="fx-stack" style={{ marginTop: 8 }}>
              {fx.boot.materials.map((m) => (
                <label key={m.id} className="fx-row" style={{ flexWrap: "nowrap" }}>
                  <span className="fx-grow">{m.name} <span className="fx-muted">({m.unit})</span></span>
                  <input className="fx-input" style={{ width: 110 }} type="number" inputMode="decimal" value={recipe[m.id] ?? ""} onChange={(e) => setRecipe({ ...recipe, [m.id]: e.target.value })} placeholder="—" />
                </label>
              ))}
            </div>
          </details>
        )}
        <Err msg={err} />
        <Act className="fx-btn pri block" onClick={async () => {
          setErr("");
          try {
            const saved = await fapi.saveProduct({ ...f, id: p.id });
            if (file === "remove") await fapi.removeProductImage(saved.id);
            else if (file) await fapi.productImage(saved.id, file);
            await fapi.saveRecipe(saved.id, Object.entries(recipe).filter(([, q]) => Number(q) > 0).map(([material_id, qty]) => ({ material_id: Number(material_id), qty: Number(qty) })));
            await refresh(fx);
            fx.toast("انحفظ المنتج");
            onClose();
          } catch (e) { setErr(e.message); }
        }}>احفظ</Act>
      </div>
    </Sheet>
  );
}

export function Vehicles() {
  const fx = useFx();
  const [edit, setEdit] = useState(null);
  return (
    <div className="fx-stack">
      <Tip id="vehicles">كل سيارة إلها سائق وحمولة ومحافظة. السائق لازم يكون إله حساب بالتطبيق (من «حسابات الموظفين»).</Tip>
      <button className="fx-btn pri" onClick={() => setEdit({})}><FiPlus /> سيارة جديدة</button>
      <div className="fx-list">
        {fx.boot.vehicles.length === 0 && <div className="fx-item"><span className="fx-muted">ما في سيارات لسا.</span></div>}
        {fx.boot.vehicles.map((v) => (
          <button key={v.id} className="fx-item" onClick={() => setEdit(v)}>
            <span className="t"><b>{v.name}{v.plate ? ` · ${v.plate}` : ""}</b><span>{v.driver_name || "بدون سائق"} · {v.governorate || "—"} · حمولة {num(v.capacity)}</span></span>
            <span className={`fx-pill ${v.status === "active" ? "ok" : v.status === "workshop" ? "warn" : ""}`}>{VSTATUS[v.status]}</span>
          </button>
        ))}
      </div>
      {edit && <VehicleSheet v={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function VehicleSheet({ v, onClose }) {
  const fx = useFx();
  const [f, setF] = useState({ name: v.name || "", plate: v.plate || "", capacity: v.capacity || 700, driver_id: v.driver_id || "", governorate: v.governorate || "", status: v.status || "active" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title={v.id ? v.name : "سيارة جديدة"} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-grid2">
          <label className="fx-field">الاسم<input className="fx-input" value={f.name} onChange={set("name")} placeholder="سيارة 7" /></label>
          <label className="fx-field">رقم اللوحة<input className="fx-input" value={f.plate} onChange={set("plate")} /></label>
        </div>
        <div className="fx-grid2">
          <label className="fx-field">الحمولة (كرتونة)<input className="fx-input" type="number" inputMode="numeric" value={f.capacity} onChange={set("capacity")} /></label>
          <label className="fx-field">المحافظة<select value={f.governorate} onChange={set("governorate")}><option value="">—</option>{fx.boot.governorates.map((g) => <option key={g}>{g}</option>)}</select></label>
        </div>
        <label className="fx-field">السائق
          <select value={f.driver_id} onChange={set("driver_id")}>
            <option value="">بدون سائق</option>
            {fx.boot.drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
          {fx.boot.drivers.length === 0 && <small>ما في حسابات سائقين. ضيفهم من «حسابات الموظفين» بدور «سائق».</small>}
        </label>
        <div className="fx-chips">{Object.entries(VSTATUS).map(([k, l]) => <button key={k} className={`fx-chip ${f.status === k ? "on" : ""}`} onClick={() => setF({ ...f, status: k })}>{l}</button>)}</div>
        <Err msg={err} />
        <Act className="fx-btn pri block" onClick={async () => {
          setErr("");
          try { await fapi.saveVehicle({ ...f, id: v.id }); await refresh(fx); fx.toast("انحفظت السيارة"); onClose(); } catch (e) { setErr(e.message); }
        }}>احفظ</Act>
      </div>
    </Sheet>
  );
}

export function Lines() {
  const fx = useFx();
  const [edit, setEdit] = useState(null);
  return (
    <div className="fx-stack">
      <Tip id="lines">الخط = منطقة بتزورها سيارة وحدة بأيام محددة. بالمحافظة اللي فيها أكثر من سيارة، قسّمها لأكثر من خط.</Tip>
      <button className="fx-btn pri" onClick={() => setEdit({})}><FiPlus /> خط جديد</button>
      <div className="fx-list">
        {fx.boot.lines.length === 0 && <div className="fx-item"><span className="fx-muted">ما في خطوط لسا.</span></div>}
        {fx.boot.lines.map((l) => (
          <button key={l.id} className="fx-item" onClick={() => setEdit(l)}>
            <span className="t"><b>{l.name}</b><span>{l.governorate || ""} · {l.vehicle_name || "بدون سيارة"}{l.days ? ` · ${String(l.days).split(",").map((d) => DAYS[d]).join("، ")}` : ""}</span></span>
            <FiChevronLeft style={{ color: "var(--fx-muted)" }} />
          </button>
        ))}
      </div>
      {edit && <LineSheet l={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function LineSheet({ l, onClose }) {
  const fx = useFx();
  const [f, setF] = useState({ name: l.name || "", governorate: l.governorate || "", vehicle_id: l.vehicle_id || "" });
  const [days, setDays] = useState(() => (l.days ? String(l.days).split(",").map(Number) : []));
  const [err, setErr] = useState("");
  return (
    <Sheet title={l.id ? l.name : "خط جديد"} onClose={onClose}>
      <div className="fx-stack">
        <label className="fx-field">اسم الخط<input className="fx-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثلًا: إربد والرمثا" /></label>
        <div className="fx-grid2">
          <label className="fx-field">المحافظة<select value={f.governorate} onChange={(e) => setF({ ...f, governorate: e.target.value })}><option value="">—</option>{fx.boot.governorates.map((g) => <option key={g}>{g}</option>)}</select></label>
          <label className="fx-field">السيارة<select value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}><option value="">—</option>{fx.boot.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        </div>
        <div className="fx-field">أيام الزيارة
          <div className="fx-chips">{DAYS.map((d, i) => <button key={d} className={`fx-chip ${days.includes(i) ? "on" : ""}`} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{d}</button>)}</div>
        </div>
        <Err msg={err} />
        <Act className="fx-btn pri block" onClick={async () => {
          setErr("");
          try { await fapi.saveLine({ ...f, days, id: l.id }); await refresh(fx); fx.toast("انحفظ الخط"); onClose(); } catch (e) { setErr(e.message); }
        }}>احفظ</Act>
        {l.id && <Act className="fx-btn danger block" onClick={async () => { await fapi.deleteLine(l.id); await refresh(fx); onClose(); }}>احذف الخط</Act>}
      </div>
    </Sheet>
  );
}

export function Machines() {
  const fx = useFx();
  const [mName, setMName] = useState("");
  const [mat, setMat] = useState({ name: "", unit: "حبة", min_level: "" });
  return (
    <div className="fx-stack">
      <Tip id="machines">المكنات عشان تسجّلوا أعطالها وتالفها. المواد الخام عشان تنخصم مع الإنتاج وتنبّهكم قبل ما تخلص.</Tip>
      <div className="fx-sec"><h2>المكنات</h2></div>
      <div className="fx-list">{fx.boot.machines.map((m) => <div key={m.id} className="fx-item"><span className="t"><b>{m.name}</b></span></div>)}</div>
      <div className="fx-row" style={{ flexWrap: "nowrap" }}>
        <input className="fx-input" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="اسم الماكنة" />
        <Act className="fx-btn pri" disabled={!mName.trim()} onClick={async () => { await fapi.saveMachine({ name: mName }); setMName(""); await refresh(fx); }}>ضيف</Act>
      </div>
      <div className="fx-sec"><h2>المواد الخام</h2></div>
      <div className="fx-list">{fx.boot.materials.map((m) => <div key={m.id} className="fx-item"><span className="t"><b>{m.name}</b><span>الرصيد {num(m.balance)} {m.unit} · الحد الأدنى {num(m.min_level)}</span></span></div>)}</div>
      <div className="fx-grid2">
        <input className="fx-input" value={mat.name} onChange={(e) => setMat({ ...mat, name: e.target.value })} placeholder="اسم المادة (مثلًا: أغطية)" />
        <input className="fx-input" value={mat.unit} onChange={(e) => setMat({ ...mat, unit: e.target.value })} placeholder="الوحدة" />
      </div>
      <div className="fx-row" style={{ flexWrap: "nowrap" }}>
        <input className="fx-input" type="number" inputMode="decimal" value={mat.min_level} onChange={(e) => setMat({ ...mat, min_level: e.target.value })} placeholder="الحد الأدنى للتنبيه" />
        <Act className="fx-btn pri" disabled={!mat.name.trim()} onClick={async () => { await fapi.saveMaterial(mat); setMat({ name: "", unit: "حبة", min_level: "" }); await refresh(fx); }}>ضيف</Act>
      </div>
    </div>
  );
}

// ---------- البونص ----------
export function Bonus() {
  const fx = useFx();
  const [edit, setEdit] = useState(null);
  const rules = fx.boot.bonus_rules || [];
  return (
    <div className="fx-stack">
      <Tip id="bonus">البونص = كراتين ببلاش مع الطلب. مثلًا «كل 100 كرتونة → 5 بونص»: الزبون بيستلم 105 وبيدفع حق 100، والسائق بيحمّلها وبيسلّمها، والفاتورة بتطلع فيها «بونص ببلاش».</Tip>
      <button className="fx-btn pri" onClick={() => setEdit({})}><FiPlus /> قاعدة بونص جديدة</button>
      <div className="fx-list">
        {rules.length === 0 && <div className="fx-item"><span className="fx-muted">ما في بونص لسا.</span></div>}
        {rules.map((r) => (
          <button key={r.id} className="fx-item" onClick={() => setEdit(r)}>
            <span className="fx-avatar" style={{ background: "var(--fx-ok-soft)", color: "var(--fx-ok)" }}><FiGift /></span>
            <span className="t">
              <b>كل {num(r.every_qty)} كرتونة ← {num(r.bonus_qty)} بونص</b>
              <span>{r.product_name || "كل المنتجات"} · {r.customer_name || "كل الزباين"}{r.name ? ` · ${r.name}` : ""}</span>
            </span>
            <span className={`fx-pill ${r.active ? "ok" : ""}`}>{r.active ? "شغال" : "موقوف"}</span>
          </button>
        ))}
      </div>
      <p className="fx-muted" style={{ margin: 0 }}>إذا في أكثر من قاعدة بتنطبق، بتمشي الأدق: الخاصة بالزبون أولًا، بعدين الخاصة بالمنتج. وأي طلب بتقدر تغيّر بونصه يدويًا لما تسجّله.</p>
      {edit && <BonusSheet r={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function BonusSheet({ r, onClose }) {
  const fx = useFx();
  const [f, setF] = useState({ name: r.name || "", product_id: r.product_id || "", customer_id: r.customer_id || "", every_qty: r.every_qty || 100, bonus_qty: r.bonus_qty || 5, active: r.active !== false });
  const [customers, setCustomers] = useState([]);
  const [err, setErr] = useState("");
  useEffect(() => { fapi.customers().then(setCustomers).catch(() => {}); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ex = Number(f.every_qty) > 0 ? Math.floor(300 / Number(f.every_qty)) * (Number(f.bonus_qty) || 0) : 0;
  return (
    <Sheet title={r.id ? "تعديل البونص" : "بونص جديد"} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-grid2">
          <label className="fx-field">كل كم كرتونة<input className="fx-input" type="number" inputMode="numeric" value={f.every_qty} onChange={set("every_qty")} /></label>
          <label className="fx-field">كم بونص ببلاش<input className="fx-input" type="number" inputMode="numeric" value={f.bonus_qty} onChange={set("bonus_qty")} /></label>
        </div>
        <div className="fx-bonus"><FiGift /> مثال: طلب 300 كرتونة ← بونص {num(ex)} · بيستلم {num(300 + ex)} وبيدفع حق 300</div>
        <label className="fx-field">على أي منتج
          <select value={f.product_id} onChange={set("product_id")}><option value="">كل المنتجات</option>{fx.boot.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label className="fx-field">لأي زبون
          <select value={f.customer_id} onChange={set("customer_id")}><option value="">كل الزباين</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="fx-field">اسم (اختياري)<input className="fx-input" value={f.name} onChange={set("name")} placeholder="مثلًا: عرض الصيف" /></label>
        {r.id && <label className="fx-row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> القاعدة شغالة</label>}
        <Err msg={err} />
        <Act className="fx-btn pri block" onClick={async () => {
          setErr("");
          try { await fapi.saveBonus({ ...f, id: r.id }); await refresh(fx); fx.toast("انحفظ البونص"); onClose(); } catch (e) { setErr(e.message); }
        }}>احفظ</Act>
        {r.id && <Act className="fx-btn danger block" onClick={async () => { await fapi.deleteBonus(r.id); await refresh(fx); onClose(); }}>احذف</Act>}
      </div>
    </Sheet>
  );
}
