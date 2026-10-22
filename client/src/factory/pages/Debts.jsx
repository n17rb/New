import { useMemo, useState } from "react";
import { FiPrinter, FiSearch, FiMessageCircle, FiCheckSquare, FiSquare } from "react-icons/fi";
import { fapi } from "../fapi.js";
import RegionFilter, { matchRegion } from "../RegionFilter.jsx";
import { useFx, useLoad, Err, Loading, Empty, Act, SendMessages, money, date } from "../ui.jsx";

// ============================================================
// الديون: مين عليه وقديش ومن إمتى — بتنطبع، وبتذكّر بلطف برسالة محترمة
// ============================================================
const SORTS = [["big", "الأكبر"], ["old", "الأقدم"], ["name", "بالاسم"]];

export function DebtsView({ page = false }) {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.debts(), []);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState(null);
  const [sort, setSort] = useState("big");
  const [sel, setSel] = useState(() => new Set());
  const [msgs, setMsgs] = useState(null);
  const canRemind = fx.can("f_money", "edit") || fx.can("f_customers", "edit") || fx.can("f_home");

  const list = useMemo(() => {
    const n = q.trim();
    const xs = (data?.customers || []).filter((c) => matchRegion(c, region) && (!n || c.name.includes(n) || (c.phone || "").includes(n) || String(c.seq_no || "") === n || (c.city || "").includes(n)));
    return xs.sort((a, b) => (sort === "old" ? b.days - a.days : sort === "name" ? a.name.localeCompare(b.name, "ar") : b.balance - a.balance));
  }, [data, q, region, sort]);
  const total = list.reduce((a, c) => a + c.balance, 0);
  const withPhone = list.filter((c) => c.phone);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function remind(ids) {
    const r = await fapi.remindDebts(ids);
    if (r.skipped) fx.toast(`${r.skipped} بدون رقم تلفون`);
    setMsgs(r.ids);
    setSel(new Set());
  }

  return (
    <div className="fx-stack fx-debts">
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          {/* للطباعة بس */}
          <div className="fx-print-only fx-debts-ph">
            <b>كشف الديون</b>
            <span>{fx.boot.factory?.name || ""} · {date(new Date().toISOString())}{region ? ` · ${[region.gov, region.dist, region.area].filter(Boolean).join(" › ")}` : ""}</span>
          </div>

          <div className="fx-debts-total">
            <div>
              <small>مجموع الديون{region || q ? " (المعروض)" : ""}</small>
              <b>{money(total)} <span>د.أ</span></b>
              <small>{list.length} زبون</small>
            </div>
            <div className="ages">
              {[["0-30", "أقل من شهر"], ["31-60", "شهر–شهرين"], ["61-90", "شهرين–3"], ["90+", "أكثر من 3 شهور"]].map(([k, l]) => (
                <span key={k} className={k === "61-90" || k === "90+" ? "old" : ""}><small>{l}</small><b>{money(data.buckets[k])}</b></span>
              ))}
            </div>
          </div>

          <div className="fx-noprint fx-stack" style={{ gap: 8 }}>
            <label className="fx-search"><FiSearch aria-hidden="true" /><input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر بالاسم، الرقم أو التلفون" /></label>
            <div className="fx-row" style={{ justifyContent: "space-between", gap: 8 }}>
              <RegionFilter items={data.customers} value={region} onChange={setRegion} noun="زبون" />
              <div className="fx-chips" style={{ flexWrap: "nowrap" }}>{SORTS.map(([k, l]) => <button key={k} className={`fx-chip ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>{l}</button>)}</div>
            </div>
            <div className="fx-grid2">
              <button className="fx-btn" onClick={() => window.print()}><FiPrinter /> اطبع الكشف</button>
              {canRemind && (sel.size > 0
                ? <Act className="fx-btn ok" onClick={() => remind([...sel])}><FiMessageCircle /> ذكّر المحددين ({sel.size})</Act>
                : <Act className="fx-btn sky" disabled={!withPhone.length} onClick={() => remind(withPhone.map((c) => c.id))}><FiMessageCircle /> ذكّر الكل ({withPhone.length})</Act>)}
            </div>
          </div>

          {list.length === 0 && <Empty title="ما في ديون" text={data.customers.length ? "ما في حدا بهالبحث." : "ولا زبون عليه دين 👏"} />}

          {/* القائمة (وهي نفسها اللي بتنطبع كجدول) */}
          <div className="fx-debts-list">
            {list.map((c) => (
              <div key={c.id} className={`d ${sel.has(c.id) ? "on" : ""}`}>
                {canRemind && (
                  <button className="fx-plain chk fx-noprint" onClick={() => toggle(c.id)} aria-label={`اختار ${c.name}`}>
                    {sel.has(c.id) ? <FiCheckSquare /> : <FiSquare />}
                  </button>
                )}
                <span className="t">
                  <b>{c.seq_no ? <small className="fx-seq">#{c.seq_no}</small> : null}{c.name}</b>
                  <small>{[c.city, c.phone].filter(Boolean).join(" · ")}</small>
                  <small className={c.days > 60 ? "old" : ""}>من {c.days} يوم{c.last_payment_at ? ` · آخر دفعة ${date(c.last_payment_at)}` : " · ما في دفعات"}{c.over_limit ? " · فوق السقف" : ""}</small>
                  {c.reminded_at && <small className="fx-noprint rem">✓ انذكّر {date(c.reminded_at)}</small>}
                </span>
                <span className="amt">
                  <b className={c.days > 60 || c.over_limit ? "old" : ""}>{money(c.balance)}</b>
                  {canRemind && c.phone && <Act className="fx-btn sm fx-noprint" onClick={() => remind([c.id])}><FiMessageCircle /> ذكّره</Act>}
                </span>
              </div>
            ))}
          </div>
          {list.length > 0 && (
            <div className="fx-print-only fx-debts-pt"><span>المجموع</span><b>{money(total)} د.أ</b></div>
          )}

          {data.cheques.length > 0 && (
            <div className="fx-card fx-noprint">
              <h3 style={{ marginTop: 0 }}>شيكات قريبة</h3>
              {data.cheques.map((c) => <div key={c.id} className="fx-kv"><span>{c.customer_name} · شيك {c.cheque_no} · يصرف {date(c.cheque_date?.slice?.(0, 10) || c.cheque_date)}</span><b>{money(-c.amount)}</b></div>)}
            </div>
          )}
        </>
      )}
      {msgs && <SendMessages ids={msgs} title="رسائل تذكير لطيفة — اكبس «ابعت» لكل وحدة" onClose={() => { setMsgs(null); reload(); }} />}
    </div>
  );
}

export default function Debts() {
  return (
    <div className="fx-page">
      <h1 className="fx-h1 fx-noprint">الديون</h1>
      <DebtsView page />
    </div>
  );
}
