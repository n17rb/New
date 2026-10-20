import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, SendMessages, Reload, HBar, money, num, date, dateTime } from "../ui.jsx";

export default function Money() {
  const fx = useFx();
  const [params, setParams] = useSearchParams();
  const tabs = [["settle", "تسليم الكاش"], ["expenses", "المصاريف"], ["debts", "الديون"], ["drivers", "عُهد السائقين"]];
  const tab = tabs.find((t) => t[0] === params.get("tab"))?.[0] || "settle";
  return (
    <div className="fx-page">
      <h1 className="fx-h1">الحسابات</h1>
      <div className="fx-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setParams({ tab: k })}>{l}</button>)}</div>
      {tab === "settle" && <Settle edit={fx.can("f_money", "edit")} />}
      {tab === "expenses" && <Expenses />}
      {tab === "debts" && <Debts />}
      {tab === "drivers" && <Drivers />}
    </div>
  );
}

function Settle({ edit }) {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.settlements(), []);
  const [handed, setHanded] = useState({});
  const [result, setResult] = useState({});
  return (
    <>
      <Tip id="settle">لما السائق يرجع: المطلوب منه = الكاش اللي حصّله − مصاريفه. اكتب قديش سلّمك بالزبط، وأي نقص بينسجل عهدة عليه.</Tip>
      <div className="fx-row" style={{ justifyContent: "flex-end" }}><Reload onClick={reload} /></div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.length === 0 && <Empty title="ما في رحلات بدها تسوية" text="لما سائق يرجع ويسكّر رحلته بتطلع هون." />}
      <div className="fx-stack" data-hl="settle-list">
        {data?.map((t) => (
          <section key={t.id} className="fx-card fx-stack">
            <div className="fx-row" style={{ justifyContent: "space-between" }}>
              <b>{t.driver_name || "بدون سائق"} · {t.vehicle_name}</b>
              <span className={`fx-pill ${t.status === "active" ? "sky" : t.settled_at ? "ok" : "warn"}`}>{t.status === "active" ? "لسا بالطريق" : t.settled_at ? "انستلم" : "رجع — بستنى التسليم"}</span>
            </div>
            <div>
              <div className="fx-kv"><span>كاش محصّل من {t.stops.filter((o) => o.status === "delivered").length} زبون</span><b>{money(t.collected)}</b></div>
              {t.expenses.filter((e) => e.status !== "rejected").map((e) => (
                <div key={e.id} className="fx-kv"><span>− {e.kind}{e.status === "pending" ? " (بانتظار الموافقة)" : ""}</span><b>{money(e.amount)}</b></div>
              ))}
              <div className="fx-kv total"><span>المطلوب تسليمه</span><b>{money(t.cash_due)} د.أ</b></div>
            </div>
            {t.settled_at && (
              <div className={`fx-note ${t.cash_diff > 0 ? "crit" : "ok"}`}>
                سلّم {money(t.handed_cash)}{t.cash_diff > 0 ? ` · نقص ${money(t.cash_diff)} انسجّل عهدة` : t.cash_diff < 0 ? ` · زيادة ${money(-t.cash_diff)}` : " · مطابق"} · {dateTime(t.settled_at)}
              </div>
            )}
            {result[t.id] && <div className={`fx-note ${result[t.id].diff > 0 ? "crit" : "ok"}`}>{result[t.id].diff > 0 ? `نقص ${money(result[t.id].diff)} — انسجّل عهدة على السائق.` : "تمام، المبلغ مطابق."}</div>}
            {edit && t.status === "returned" && !t.settled_at && (
              <div className="fx-row" style={{ flexWrap: "nowrap" }}>
                <input className="fx-input" type="number" inputMode="decimal" value={handed[t.id] ?? t.cash_due} onChange={(e) => setHanded({ ...handed, [t.id]: e.target.value })} aria-label="المبلغ المستلم" />
                <Act className="fx-btn pri" onClick={async () => {
                  const r = await fapi.receiveCash(t.id, Number(handed[t.id] ?? t.cash_due));
                  setResult({ ...result, [t.id]: r });
                  fx.toast("انستلم الكاش");
                  reload();
                }}>استلمت</Act>
              </div>
            )}
            {t.status === "returned" && t.returns_expected?.length > 0 && !t.returns_received_at && <span className="fx-muted" style={{ fontSize: 12.5 }}>بستنى أمين المستودع يستلم {num(t.returns_expected.reduce((s, x) => s + x.qty, 0))} كرتونة راجعة.</span>}
          </section>
        ))}
      </div>
    </>
  );
}

function Expenses() {
  const fx = useFx();
  const can = fx.canAction("approve_expense");
  const { data, error, reload } = useLoad(() => fapi.expenses(), []);
  const pending = (data || []).filter((e) => e.status === "pending");
  const rest = (data || []).filter((e) => e.status !== "pending");
  const Row = ({ e }) => (
    <div className="fx-card fx-stack" style={{ gap: 8 }}>
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <b>{e.kind} · {money(e.amount)} د.أ</b>
        <span className={`fx-pill ${e.status === "approved" ? "ok" : e.status === "rejected" ? "crit" : "warn"}`}>{e.status === "approved" ? "معتمد" : e.status === "rejected" ? "مرفوض" : "بستنى"}</span>
      </div>
      <span className="fx-muted">{e.driver_name} · {e.vehicle_name || ""} · {dateTime(e.created_at)}{e.liters ? ` · ${e.liters} لتر` : ""}{e.odo ? ` · العداد ${num(e.odo)}` : ""}</span>
      {e.note && <span>{e.note}</span>}
      <div className="fx-row">
        {e.photo_url && <a href={e.photo_url} target="_blank" rel="noreferrer"><img className="fx-photo" src={e.photo_url} alt="الفاتورة" /></a>}
        {e.odo_photo_url && <a href={e.odo_photo_url} target="_blank" rel="noreferrer"><img className="fx-photo" src={e.odo_photo_url} alt="العداد" /></a>}
      </div>
      {can && e.status === "pending" && (
        <div className="fx-row">
          <Act className="fx-btn ok fx-grow" onClick={async () => { await fapi.approveExpense(e.id); fx.toast("انعتمد"); reload(); }}>وافق</Act>
          <Act className="fx-btn danger fx-grow" onClick={async () => { await fapi.rejectExpense(e.id); fx.toast("انرفض ورجع على السائق"); reload(); }}>ارفض</Act>
        </div>
      )}
    </div>
  );
  return (
    <>
      <Tip id="expenses">كل مصروف معه صورة الفاتورة. الديزل معه صورة العداد كمان. المرفوض بيرجع عهدة على السائق.</Tip>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="fx-sec"><h2>بستنى موافقتك ({pending.length})</h2></div>
          <div className="fx-stack">{pending.length ? pending.map((e) => <Row key={e.id} e={e} />) : <p className="fx-muted" style={{ margin: 0 }}>ما في إشي بستنى.</p>}</div>
          <div className="fx-sec"><h2>آخر ٣٠ يوم</h2></div>
          <div className="fx-stack">{rest.slice(0, 30).map((e) => <Row key={e.id} e={e} />)}</div>
        </>
      )}
    </>
  );
}

function Debts() {
  const fx = useFx();
  const { data, error } = useLoad(() => fapi.debts(), []);
  const [msgs, setMsgs] = useState(null);
  const max = data ? Math.max(1, ...Object.values(data.buckets)) : 1;
  return (
    <>
      <Tip id="debts">الديون مقسّمة حسب عمرها. اكبس «ذكّره» وبتطلع رسالة تذكير لطيفة جاهزة للواتساب.</Tip>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="fx-card fx-stack">
            <span className="fx-muted">مجموع الديون</span>
            <b style={{ fontSize: 26, color: "var(--fx-navy)" }} className="fx-num">{money(data.total)} د.أ</b>
            <HBar label="أقل من ٣٠ يوم" value={data.buckets["0-30"]} max={max} />
            <HBar label="٣١ – ٦٠ يوم" value={data.buckets["31-60"]} max={max} />
            <HBar label="٦١ – ٩٠ يوم" value={data.buckets["61-90"]} max={max} tone="over" />
            <HBar label="أكثر من ٩٠ يوم" value={data.buckets["90+"]} max={max} tone="over" />
          </div>
          {data.cheques.length > 0 && (
            <>
              <div className="fx-sec"><h2>شيكات قريبة</h2></div>
              <div className="fx-list">
                {data.cheques.map((c) => <div key={c.id} className="fx-item"><span className="t"><b>{c.customer_name}</b><span>شيك {c.cheque_no} · يصرف {date(c.cheque_date?.slice?.(0, 10) || c.cheque_date)}</span></span><b>{money(-c.amount)}</b></div>)}
              </div>
            </>
          )}
          <div className="fx-sec"><h2>الزباين ({data.customers.length})</h2></div>
          <div className="fx-list">
            {data.customers.length === 0 && <div className="fx-item"><span className="fx-muted">ولا زبون عليه دين.</span></div>}
            {data.customers.map((c) => (
              <div key={c.id} className="fx-item">
                <span className="t">
                  <b>{c.name}</b>
                  <span>{c.city || ""} · من {c.days} يوم{c.over_limit ? " · فوق السقف" : ""}</span>
                </span>
                <span className="end">
                  <b className="fx-num" style={{ color: c.days > 60 || c.over_limit ? "var(--fx-crit)" : "inherit" }}>{money(c.balance)}</b>
                  {c.phone && (fx.can("f_customers", "edit") || fx.can("f_home")) ? (
                    <Act className="fx-link" onClick={async () => {
                      const r = await fapi.sendMessage({ customer_ids: [c.id], body: `تذكير لطيف: رصيد حسابك عنا ${money(c.balance)} دينار. بنشكرك على تعاملك معنا.` });
                      setMsgs(r.ids);
                    }}>ذكّره</Act>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {msgs && <SendMessages ids={msgs} title="تذكير بالدين" onClose={() => setMsgs(null)} />}
    </>
  );
}

function Drivers() {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.drivers(), []);
  const [open, setOpen] = useState(null);
  return (
    <>
      <Tip id="drivers">العُهدة = نقص كاش أو كراتين على السائق. بتنسدّ كاش، أو بتنخصم من راتبه بكبسة (وبتنزل بكشف راتبه).</Tip>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.length === 0 && <Empty title="ما في سائقين" text="اربط السائقين بالسيارات من الإعدادات." />}
      {data && data.length > 0 && (
        <div className="fx-list">
          {data.map((d) => (
            <button key={d.id} className="fx-item" onClick={() => setOpen(d)}>
              <span className="fx-avatar">{d.full_name.trim().charAt(0)}</span>
              <span className="t"><b>{d.full_name}</b><span>{d.vehicle_name || ""}{d.cash_now ? ` · معه هلأ ${money(d.cash_now)}` : ""}</span></span>
              <span className="end"><b className="fx-num" style={{ color: d.custody > 0 ? "var(--fx-crit)" : "var(--fx-ok)" }}>{money(d.custody)}</b><span className="fx-muted" style={{ fontSize: 11.5 }}>عُهدة</span></span>
            </button>
          ))}
        </div>
      )}
      {open && <DriverSheet d={open} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function DriverSheet({ d, onClose }) {
  const fx = useFx();
  const { data, reload } = useLoad(() => fapi.driverLedger(d.id), [d.id]);
  const [kind, setKind] = useState("payment");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const K = { shortage: "نقص", surplus: "زيادة", payment: "سدّد", deduction: "انخصم من الراتب", adjust: "تعديل" };
  return (
    <Sheet title={`عُهد ${d.full_name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-card"><div className="fx-kv total"><span>عليه هلأ</span><b>{money(d.custody)} د.أ</b></div></div>
        {fx.can("f_money", "edit") && (
          <>
            <div className="fx-chips">{[["payment", "سدّد كاش"], ["deduction", "اخصم من راتبه"], ["adjust", "تعديل"]].map(([k, l]) => <button key={k} className={`fx-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{l}</button>)}</div>
            <div className="fx-grid2">
              <input className="fx-input" type="number" inputMode="decimal" placeholder="المبلغ" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className="fx-input" placeholder="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Act className="fx-btn pri" disabled={!amount} onClick={async () => { await fapi.driverLedgerAdd(d.id, { kind, amount, note }); fx.toast("انسجل"); setAmount(""); setNote(""); reload(); d.custody = kind === "adjust" ? d.custody + Number(amount) : d.custody - Math.abs(Number(amount)); }}>سجّل</Act>
          </>
        )}
        <div className="fx-list">
          {!data && <div className="fx-item"><Loading /></div>}
          {data?.length === 0 && <div className="fx-item"><span className="fx-muted">ما في حركات.</span></div>}
          {data?.map((x) => (
            <div key={x.id} className="fx-item">
              <span className="t"><b>{K[x.kind]}</b><span>{dateTime(x.created_at)}{x.note ? ` · ${x.note}` : ""}</span></span>
              <b className="fx-num" style={{ color: x.amount > 0 ? "var(--fx-crit)" : "var(--fx-ok)" }}>{money(x.amount)}</b>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

