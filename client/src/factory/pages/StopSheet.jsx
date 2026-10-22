import { useEffect, useState } from "react";
import { FiMapPin, FiPhone, FiMessageCircle, FiFileText, FiCheckCircle, FiNavigation, FiPrinter } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { Invoice } from "../Track.jsx";
import { useFx, Sheet, StatusPill, ORDER_STATUS, waLink, money, num, dateTime, Err, Loading } from "../ui.jsx";
import { shareInvoicePdf } from "../invoicePdf.js";

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

// ملخّص الفاتورة برسالة واتساب وحدة — بتنفتح على محادثة الزبون مباشرة، ومعها رابط الفاتورة (منه بينزّل PDF)
export function invoiceSummary(data, link) {
  const { brand, invoice: inv, items, exchanges = [] } = data;
  const lines = [];
  for (const i of items) {
    const q = i.delivered_qty ?? i.qty;
    if (q > 0) lines.push(`• ${q} × ${i.name} = ${money(i.line)}`);
    const b = i.delivered_bonus ?? i.bonus_qty;
    if (b > 0) lines.push(`• ${b} × ${i.name} بونص ببلاش 🎁`);
  }
  for (const x of exchanges) lines.push(`• 🔁 بدّلنا ${x.qty} ${x.name} تالف بجديد ببلاش`);
  const rest = Math.max(0, inv.total - inv.paid);
  const bal = inv.balance_after == null ? null : Number(inv.balance_after);
  return [
    `مرحبا ${inv.customer_name} 🌷`,
    `هاي فاتورتك رقم ${inv.id} من ${brand.name}:`,
    "",
    ...lines,
    "",
    `المجموع: ${money(inv.total)} د.أ`,
    `المدفوع: ${money(inv.paid)} د.أ`,
    rest > 0.005 ? `الباقي عليها: ${money(rest)} د.أ` : "الفاتورة مدفوعة ✓",
    bal != null ? `رصيد حسابك: ${bal > 0.005 ? `${money(bal)} د.أ عليك` : bal < -0.005 ? `${money(-bal)} د.أ إلك عنّا` : "مسكّر ✓"}` : null,
    "",
    `الفاتورة كاملة (وبتقدر تنزّلها PDF): ${link}`,
    `شكرًا لتعاملكم معنا 🙏${brand.phone ? `\n${brand.name} ${brand.phone}` : ""}`,
  ].filter((x) => x !== null).join("\n");
}

// نسخة الفاتورة عندك بالتطبيق (نفس اللي وصلت للزبون)، وزر يبعتها للزبون على واتساب
export function InvoiceSheet({ o, onClose, onSent, title }) {
  const fx = useFx();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fapi.invoice(o.invoice_token).then(setData).catch((e) => setErr(e.message)); }, [o.invoice_token]);
  const link = `${window.location.origin}/t/i/${o.invoice_token}`;
  const phone = o.phone || data?.invoice?.phone;

  async function sendPdf() {
    setBusy(true);
    const msg = invoiceSummary(data, link);
    // نسخة من الرسالة على الحافظة: إذا واتساب ما حط النص مع الملف، بيلصقه
    try { await navigator.clipboard?.writeText(msg); } catch { /* مش مشكلة */ }
    try {
      const r = await shareInvoicePdf(data, { text: msg });
      if (r === "downloaded") {
        fx.toast("نزل ملف الفاتورة PDF — افتح محادثة الزبون بواتساب وارفقه");
        if (phone) window.open(waLink(phone, msg), "_blank");
      }
      if (r !== "cancelled") onSent?.();
    } catch (e) { fx.toast(e.message || "ما زبط إنشاء الـPDF"); } finally { setBusy(false); }
  }

  return (
    <Sheet title={title || `فاتورة #${o.id}`} onClose={onClose}>
      <Err msg={err} />
      {!data && !err && <Loading />}
      {data && (
        <div className="fx-stack">
          <button className="fx-btn wa block fx-big fx-noprint" disabled={busy} onClick={sendPdf}>
            <FiFileText /> {busy ? "عم بجهّز الفاتورة…" : "ابعت الفاتورة PDF + الرابط للزبون"}
          </button>
          <small className="fx-muted fx-noprint" style={{ textAlign: "center" }}>بيفتح واتساب: اختار {o.customer_name} وابعت. الرسالة والرابط مع الملف (وكمان منسوخين لو بدك تلصقهم).</small>
          <div className="fx-invoice-in"><Invoice data={data} inApp /></div>
          <div className="fx-grid2 fx-noprint">
            {phone ? <a className="fx-btn" href={waLink(phone, invoiceSummary(data, link))} target="_blank" rel="noreferrer" onClick={() => onSent?.()}><FiMessageCircle /> رسالة لرقمه بس</a> : <span />}
            <button className="fx-btn" onClick={() => window.print()}><FiPrinter /> اطبع</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
