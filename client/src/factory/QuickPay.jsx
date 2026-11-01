import { useEffect, useState } from "react";
import { fapi } from "./fapi.js";
import { Sheet, money } from "./ui.jsx";
import { PaySheet } from "./pages/Debts.jsx";

// قبض من زبون (كاش، شيك، كليك، حوالة) من الرئيسية: بتختار الزبون وبتسجّل
export default function QuickPay({ onClose, onDone, method = "cash", title = "قبض من زبون" }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [c, setC] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => fapi.customers(q.trim() ? { q } : {}).then((l) => setList(q.trim() ? l : l.filter((x) => Number(x.balance) > 0.009))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (c) return <PaySheet c={c} initialMethod={method} onClose={() => setC(null)} onDone={(r) => { setC(null); onDone?.(r); }} />;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="fx-stack">
        <input className="fx-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الزبون، رقمه أو تلفونه" />
        {!q.trim() && <small className="fx-muted">{method === "cheque" ? "مين أعطاك الشيك؟ اكتب اسمه — أو اختار من اللي عليهم دين." : "اللي عليهم دين — أو دوّر على أي زبون."}</small>}
        <div className="fx-list" style={{ maxHeight: 360, overflow: "auto" }}>
          {list.slice(0, 60).map((x) => (
            <button key={x.id} className="fx-item" onClick={() => setC(x)}>
              <span className="t"><b>{x.name}</b><span>{[x.city, x.phone].filter(Boolean).join(" · ")}</span></span>
              {Number(x.balance) > 0.009 && <b className="fx-num" style={{ color: "#b06a00" }}>{money(x.balance)}</b>}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
