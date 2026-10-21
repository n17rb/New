import { useEffect, useState } from "react";
import { FiMapPin, FiPhone, FiMessageCircle, FiFileText, FiCheckCircle, FiNavigation, FiPrinter } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { Invoice } from "../Track.jsx";
import { Sheet, StatusPill, ORDER_STATUS, waLink, money, num, dateTime, Err, Loading } from "../ui.jsx";

export const deliveredCartons = (o) => o.items.reduce((s, i) => s + (i.delivered_qty ?? i.qty) + (i.delivered_bonus ?? i.bonus_qty ?? 0), 0);

// تفاصيل الوقفة: مين الزبون ووين، شو انطلب وشو انسلّم، الكاش، والإثبات
export function StopSheet({ o, t, onClose }) {
  const [inv, setInv] = useState(false);
  const map = o.lat ? `https://www.google.com/maps?q=${o.lat},${o.lng}` : o.maps_url;
  const where = o.delivered_lat ? `https://www.google.com/maps?q=${o.delivered_lat},${o.delivered_lng}` : null;
  const far = o.delivered_lat && o.lat ? kmBetween([o.lat, o.lng], [o.delivered_lat, o.delivered_lng]) : null;
  const delivered = o.status === "delivered";
  const debt = delivered ? Math.max(0, (o.delivered_total || 0) - (o.cash_paid || 0)) : 0;
  return (
    <Sheet title={`طلب #${o.id}`} onClose={onClose}>
      <div className="fx-stack">
        {o.photo_url && <a href={o.photo_url} target="_blank" rel="noreferrer"><img className="fx-building" src={o.photo_url} alt={`صورة محل ${o.customer_name}`} /></a>}
        <div className="fx-card fx-stack" style={{ gap: 6 }}>
          <div className="fx-row" style={{ justifyContent: "space-between" }}>
            <b style={{ fontSize: 17 }}>{o.seq_no ? <span className="fx-seq">#{o.seq_no}</span> : null}{o.customer_name}</b>
            <StatusPill map={ORDER_STATUS} value={o.status} />
          </div>
          <span className="fx-muted">{[o.city, o.address].filter(Boolean).join(" · ") || "بدون عنوان"}</span>
          {o.phone && <span className="fx-muted" dir="ltr" style={{ textAlign: "end" }}>{o.phone}</span>}
          <div className="fx-row">
            {o.phone && <a className="fx-btn sm" href={`tel:${o.phone}`}><FiPhone /> اتصل</a>}
            {o.phone && <a className="fx-btn wa sm" href={waLink(o.phone, "")} target="_blank" rel="noreferrer"><FiMessageCircle /> واتساب</a>}
            {map ? <a className="fx-btn sky sm" href={map} target="_blank" rel="noreferrer"><FiMapPin /> موقع الزبون</a> : <span className="fx-pill warn">بدون موقع</span>}
          </div>
        </div>

        <div className="fx-sec"><h2>{delivered ? "شو انسلّم" : "الطلب"}</h2></div>
        <div className="fx-table">
          <table>
            <thead><tr><th>المنتج</th><th>طلب</th>{delivered && <th>سلّم</th>}<th>بونص</th>{delivered && <th>تالف</th>}</tr></thead>
            <tbody>
              {o.items.map((i) => {
                const got = i.delivered_qty ?? i.qty;
                return (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className="fx-num">{num(i.qty)}</td>
                    {delivered && <td className="fx-num" style={{ color: got < i.qty ? "var(--fx-crit)" : "var(--fx-ok)", fontWeight: 700 }}>{num(got)}</td>}
                    <td className="fx-num">{num(delivered ? (i.delivered_bonus ?? i.bonus_qty ?? 0) : i.bonus_qty || 0)}</td>
                    {delivered && <td className="fx-num">{i.damaged_qty ? num(i.damaged_qty) : "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {delivered && (
          <div className="fx-card">
            <div className="fx-kv"><span>وقت التسليم</span><b>{dateTime(o.delivered_at)}</b></div>
            <div className="fx-kv"><span>السائق</span><b>{t?.driver_name || o.driver_name || "—"} · {t?.vehicle_name || o.vehicle_name || ""}</b></div>
            <div className="fx-kv"><span>قيمة الفاتورة</span><b>{money(o.delivered_total)} د.أ</b></div>
            <div className="fx-kv"><span>دفع كاش</span><b style={{ color: "var(--fx-ok)" }}>{money(o.cash_paid)} د.أ</b></div>
            {debt > 0 && <div className="fx-kv"><span>ضل عليه (دين)</span><b style={{ color: "var(--fx-crit)" }}>{money(debt)} د.أ</b></div>}
          </div>
        )}
        {o.status === "failed" && <div className="fx-note crit">ما تسلّم: {o.fail_reason}</div>}

        {(where || o.proof_photo || /^(data:image|https:)/.test(o.signature || "")) && (
          <>
            <div className="fx-sec"><h2>الإثبات</h2></div>
            <div className="fx-card fx-stack">
              {where && (
                <div className="fx-row" style={{ justifyContent: "space-between" }}>
                  <span>{far == null ? "مكان السائق وقت التسليم" : far <= 0.3 ? <><FiCheckCircle style={{ color: "var(--fx-ok)" }} /> سلّم عند موقع الزبون</> : <span style={{ color: far > 1 ? "var(--fx-crit)" : "var(--fx-muted)" }}>سلّم على بعد {far.toFixed(1)} كم من موقع الزبون</span>}</span>
                  <a className="fx-btn sm" href={where} target="_blank" rel="noreferrer"><FiNavigation /> شوف المكان</a>
                </div>
              )}
              <div className="fx-row">
                {o.proof_photo && <a href={o.proof_photo} target="_blank" rel="noreferrer"><img className="fx-proof" src={o.proof_photo} alt="صورة التسليم" /></a>}
                {/^(data:image|https:)/.test(o.signature || "") && <img className="fx-proof sig" src={o.signature} alt="توقيع الزبون" />}
              </div>
            </div>
          </>
        )}
        {delivered && o.invoice_token && (
          <button className="fx-btn pri block" onClick={() => setInv(true)}><FiFileText /> الفاتورة</button>
        )}
        {inv && <InvoiceSheet o={o} onClose={() => setInv(false)} />}
      </div>
    </Sheet>
  );
}

function kmBetween(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// نسخة الفاتورة عندك بالتطبيق (نفس اللي وصلت للزبون)، وزر يبعتها للزبون على واتساب
export function InvoiceSheet({ o, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { fapi.invoice(o.invoice_token).then(setData).catch((e) => setErr(e.message)); }, [o.invoice_token]);
  const link = `${window.location.origin}/t/i/${o.invoice_token}`;
  const text = `أهلاً ${o.customer_name}، هاي فاتورة طلبك رقم ${o.id}${data ? ` بقيمة ${money(data.invoice.total)} د.أ` : ""}:\n${link}`;
  return (
    <Sheet title={`فاتورة #${o.id}`} onClose={onClose}>
      <Err msg={err} />
      {!data && !err && <Loading />}
      {data && (
        <div className="fx-stack">
          <div className="fx-invoice-in"><Invoice data={data} inApp /></div>
          <div className="fx-grid2 fx-noprint">
            {o.phone ? <a className="fx-btn wa" href={waLink(o.phone, text)} target="_blank" rel="noreferrer"><FiMessageCircle /> ابعتها للزبون</a> : <span />}
            <button className="fx-btn" onClick={() => window.print()}><FiPrinter /> اطبع</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
