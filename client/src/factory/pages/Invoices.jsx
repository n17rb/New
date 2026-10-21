import { useEffect, useState } from "react";
import { FiSearch, FiFileText } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { Err, Loading, money, num, date, time } from "../ui.jsx";
import { InvoiceSheet } from "./StopSheet.jsx";

// ============================================================
// الفواتير: نسخة عندك من كل فاتورة وصلت للزبون — مين سلّمها، إمتى، وكم
// ============================================================
export default function Invoices() {
  const [q, setQ] = useState("");
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => fapi.invoices({ q, days: 60 }).then(setList).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const total = (list || []).reduce((s, x) => s + x.delivered_total, 0);

  return (
    <div className="fx-page">
      <div className="fx-chead"><h1>الفواتير {list && <span className="n fx-num">{num(list.length)}</span>}</h1></div>
      <div className="fx-csearch">
        <FiSearch aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الزبون، السائق، أو رقم الفاتورة" aria-label="بحث" />
      </div>
      <Err msg={err} />
      {!list && !err && <Loading />}
      {list && list.length === 0 && <div className="fx-empty-soft">ما في فواتير آخر شهرين.</div>}
      {list && list.length > 0 && <p className="fx-muted" style={{ margin: 0, fontSize: 13 }}>آخر شهرين · المجموع {money(total)} د.أ</p>}
      <div className="fx-clist">
        {list?.map((x) => (
          <button key={x.id} className="fx-crow fx-plain" style={{ width: "100%" }} onClick={() => setOpen(x)}>
            <span className="fx-cav"><FiFileText /></span>
            <span className="t" style={{ flex: 1, display: "grid", gap: 2, minWidth: 0, textAlign: "start" }}>
              <b>{x.customer_name} <span className="fx-muted" style={{ fontWeight: 400, fontSize: 12.5 }}>#{x.id}</span></b>
              <small className="fx-muted">سلّمها {x.driver_name || "—"}{x.vehicle_name ? ` · ${x.vehicle_name}` : ""} · {date(x.delivered_at)} {time(x.delivered_at)}</small>
              <small className="fx-muted">{num(x.cartons)} كرتونة · كاش {money(x.cash_paid)}{x.delivered_total > x.cash_paid ? ` · دين ${money(x.delivered_total - x.cash_paid)}` : ""}</small>
            </span>
            <b className="fx-num" style={{ color: "var(--fx-navy)", whiteSpace: "nowrap" }}>{money(x.delivered_total)}</b>
          </button>
        ))}
      </div>
      {open && <InvoiceSheet o={{ id: open.id, invoice_token: open.invoice_token, customer_name: open.customer_name, phone: open.phone }} onClose={() => setOpen(null)} />}
    </div>
  );
}
