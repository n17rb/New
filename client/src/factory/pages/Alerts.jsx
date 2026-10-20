import { fapi } from "../fapi.js";
import { useLoad, Tip, Err, Loading, Empty, Reload } from "../ui.jsx";
import { AlertCard } from "./Home.jsx";

export default function Alerts() {
  const { data, error, reload } = useLoad(() => fapi.alerts(), []);
  const open = (data || []).filter((a) => !a.closed_at);
  const closed = (data || []).filter((a) => a.closed_at);
  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}><h1 className="fx-h1">التنبيهات</h1><Reload onClick={reload} /></div>
      <Tip id="alerts">أي إشي بيصير مع السائقين أو بالمصنع بيوصلك هون: تأخير، تتبع مقطوع، ديزل، نقص كاش أو كراتين، أعطال. الأحمر بدّه تصرّف.</Tip>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && open.length === 0 && <Empty title="ما في تنبيهات مفتوحة" text="كل إشي ماشي تمام." />}
      <div className="fx-stack">{open.map((a) => <AlertCard key={a.id} a={a} onClose={async (id) => { await fapi.closeAlert(id); reload(); }} />)}</div>
      {closed.length > 0 && (
        <>
          <div className="fx-sec"><h2>آخر يومين</h2></div>
          <div className="fx-stack">{closed.map((a) => <AlertCard key={a.id} a={a} />)}</div>
        </>
      )}
    </div>
  );
}
