import { Fragment, useEffect, useState } from "react";
import { fapi } from "./fapi.js";
import "./factory.css";

// ============================================================
// صفحات الزبون (بدون تسجيل دخول): متابعة الطلبات + كشف الحساب، والفاتورة
// ============================================================
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const t = (iso) => (iso ? new Date(iso).toLocaleTimeString("ar-JO-u-nu-latn", { hour: "numeric", minute: "2-digit" }) : "");
const d = (iso) => (iso ? new Date(iso).toLocaleDateString("ar-JO-u-nu-latn", { weekday: "short", day: "numeric", month: "numeric" }) : "");
const STEP = { new: 0, delayed: 0, assigned: 1, onway: 2, delivered: 3, failed: 2, cancelled: 0 };
const KIND = { invoice: "فاتورة", payment: "دفعة", return: "مرتجع", adjust: "تعديل", opening: "رصيد سابق" };

function Head({ brand }) {
  return (
    <div className="fx-public-head">
      {brand.logo ? <img src={brand.logo} alt={brand.name} /> : <b style={{ fontSize: 22, color: "var(--fx-navy)" }}>{brand.name}</b>}
      {brand.tagline && <span className="fx-muted">{brand.tagline}</span>}
    </div>
  );
}

export default function Track({ path }) {
  const invoice = path.startsWith("i/");
  const token = decodeURIComponent(invoice ? path.slice(2) : path);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    (invoice ? fapi.invoice(token) : fapi.track(token)).then(setData).catch((e) => setErr(e.message));
  }, [token, invoice]);

  if (err) return <div className="fx"><div className="fx-public"><div className="fx-err">{err}</div></div></div>;
  if (!data) return <div className="fx"><div className="fx-public"><p className="fx-muted">جاري التحميل...</p></div></div>;
  return <div className="fx">{invoice ? <Invoice data={data} /> : <Orders data={data} />}</div>;
}

function Orders({ data }) {
  const { brand, customer, orders, ledger } = data;
  const open = orders.filter((o) => ["new", "assigned", "onway", "delayed"].includes(o.status));
  const done = orders.filter((o) => !["new", "assigned", "onway", "delayed"].includes(o.status));
  return (
    <div className="fx-public">
      <Head brand={brand} />
      <div className="fx-card" style={{ textAlign: "center" }}>
        <b style={{ fontSize: 17 }}>{customer.name}</b>
        <div className="fx-muted">رصيد حسابك</div>
        <b className="fx-num" style={{ fontSize: 26, color: customer.balance > 0 ? "var(--fx-crit)" : "var(--fx-ok)" }}>{balWord(customer.balance)}</b>
      </div>
      <h2 style={{ fontSize: 16, margin: "6px 0 0" }}>طلباتك الحالية</h2>
      {open.length === 0 && <p className="fx-muted" style={{ margin: 0 }}>ما في طلبات مفتوحة. لطلب جديد اتصل على {brand.phone}.</p>}
      {open.map((o) => (
        <div key={o.id} className="fx-card fx-stack" style={{ gap: 6 }}>
          <div className="fx-row" style={{ justifyContent: "space-between" }}><b>طلب #{o.id}</b><span className="fx-muted">{o.items}</span></div>
          {o.status === "onway" && o.eta_at && <div className="fx-note sky">السائق {o.driver_name} بالطريق{o.stops_before ? ` · قبلك ${o.stops_before} زباين` : ""}. الوصول المتوقع حوالي <b>{t(o.eta_at)}</b>.</div>}
          {o.status === "assigned" && <div className="fx-note sky">طلبك على {o.vehicle_name} مع {o.driver_name}. {o.eta_at ? `الموعد المتوقع ${d(o.eta_at)} حوالي ${t(o.eta_at)}.` : ""}</div>}
          {o.status === "delayed" && <div className="fx-note warn">نعتذر، طلبك متأخر{o.delay_reason ? ` بسبب ${o.delay_reason}` : ""}. الموعد الجديد {d(o.due_date)}.</div>}
          {o.status === "new" && <div className="fx-note">وصلنا طلبك. موعد التوصيل {d(o.due_date)}.</div>}
          <div className="fx-timeline">
            {["وصلنا", "على السيارة", "بالطريق", "تسلّم"].map((s, i) => <span key={s} className={STEP[o.status] >= i ? "on" : ""}>{s}</span>)}
          </div>
        </div>
      ))}
      {done.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: "6px 0 0" }}>آخر الطلبات</h2>
          <div className="fx-list">
            {done.map((o) => (
              <div key={o.id} className="fx-item">
                <span className="t"><b>#{o.id} · {o.items}</b><span>{o.delivered_at ? `تسلّم ${d(o.delivered_at)}` : o.status === "failed" ? "ما تسلّم" : "انلغى"}</span></span>
                {o.invoice_token && <a className="fx-link" href={`/t/i/${o.invoice_token}`}>الفاتورة</a>}
              </div>
            ))}
          </div>
        </>
      )}
      <h2 style={{ fontSize: 16, margin: "6px 0 0" }}>كشف الحساب</h2>
      <div className="fx-table">
        <table>
          <thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th><th>الرصيد</th></tr></thead>
          <tbody>{ledger.map((g, i) => <tr key={i}><td>{d(g.created_at)}</td><td>{KIND[g.kind]}</td><td>{money(g.amount)}</td><td>{money(g.balance_after)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="fx-muted" style={{ textAlign: "center", margin: 0 }}>{brand.name}{brand.phone ? ` · ${brand.phone}` : ""}</p>
    </div>
  );
}

// الزبون بينزّل فاتورته PDF من الرابط
function PdfBtn({ data }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="fx-btn pri block fx-noprint" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const { shareInvoicePdf } = await import("./invoicePdf.js"); await shareInvoicePdf(data); } finally { setBusy(false); }
    }}>{busy ? "بجهّز الملف…" : "⬇️ نزّل الفاتورة PDF"}</button>
  );
}

// الرصيد بكلام مفهوم بدل السالب
export const balWord = (n) => { const v = Number(n || 0); return v > 0.009 ? `${money(v)} د.أ عليك` : v < -0.009 ? `${money(-v)} د.أ إلك عنّا` : "0.00 — مسكّر ✓"; };

export function Invoice({ data, inApp = false }) {
  const { brand, invoice: inv, items, exchanges = [] } = data;
  return (
    <div className="fx-public">
      <Head brand={brand} />
      <div className="fx-card fx-stack">
        <div className="fx-row" style={{ justifyContent: "space-between" }}><b>فاتورة رقم {inv.id}</b><span className="fx-muted">{d(inv.delivered_at)} {t(inv.delivered_at)}</span></div>
        <div className="fx-kv"><span>الزبون</span><b>{inv.customer_name}</b></div>
        {inv.driver_name && <div className="fx-kv"><span>سلّمها</span><b>{inv.driver_name} · {inv.vehicle_name}</b></div>}
        <div className="fx-kv"><span>وقت التسليم</span><b>{d(inv.delivered_at)} {t(inv.delivered_at)}</b></div>
      </div>
      <div className="fx-table">
        <table>
          <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
          <tbody>
            {items.map((i, k) => (
              <Fragment key={k}>
                {(i.delivered_qty ?? i.qty) > 0 && <tr><td>{i.name}</td><td>{i.delivered_qty ?? i.qty}</td><td>{money(i.price)}</td><td>{money(i.line)}</td></tr>}
                {(i.delivered_bonus ?? i.bonus_qty) > 0 && <tr style={{ color: "var(--fx-ok)" }}><td>بونص {i.name}</td><td>{i.delivered_bonus ?? i.bonus_qty}</td><td>ببلاش</td><td>0.00</td></tr>}
              </Fragment>
            ))}
            {exchanges.map((x, k) => (
              <tr key={`x${k}`} style={{ color: "#5b3cc4" }}><td>🔁 استبدال تالف {x.name}</td><td>{x.qty}</td><td>ببلاش</td><td>0.00</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {exchanges.length > 0 && <div className="fx-note" style={{ background: "#f6f2ff", color: "#5b3cc4" }}>أخذنا منك {exchanges.map((x) => `${x.qty} ${x.name}`).join(" و")} تالف، وأعطيناك بدالها جديد ببلاش.</div>}
      <div className="fx-card">
        <div className="fx-kv total"><span>المجموع</span><b>{money(inv.total)} د.أ</b></div>
        <div className="fx-kv"><span>المدفوع</span><b>{money(inv.paid)}</b></div>
        <div className="fx-kv"><span>الباقي على الفاتورة</span><b>{money(Math.max(0, inv.total - inv.paid))}</b></div>
        {inv.balance_after != null && <div className="fx-kv"><span>رصيد حسابك الكلي</span><b>{balWord(inv.balance_after)}</b></div>}
      </div>
      {inv.signature && <div className="fx-card"><span className="fx-muted">توقيع المستلم</span><img src={inv.signature} alt="التوقيع" style={{ width: "100%", maxHeight: 120, objectFit: "contain" }} /></div>}
      {!inApp && <PdfBtn data={data} />}
      {inv.track_token && !inApp && <a className="fx-btn sky block fx-noprint" href={`/t/${inv.track_token}`}>كل طلباتي وكشف حسابي</a>}
      <p className="fx-muted" style={{ textAlign: "center", margin: 0 }}>{brand.name}{brand.phone ? ` · ${brand.phone}` : ""}</p>
    </div>
  );
}
