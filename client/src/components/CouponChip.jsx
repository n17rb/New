// علامة صغيرة بتبيّن إنه الزبون معه كوبونات إلكترونية (ومعه كم)
export default function CouponChip({ balance, label = false }) {
  const n = Math.max(0, Math.floor(Number(balance) || 0));
  if (!n) return null;
  return (
    <span className="cp-chip tabular-num" title={`معه ${n} كوبون إلكتروني`} aria-label={`معه ${n} كوبون إلكتروني`}>
      <svg viewBox="0 0 24 16" aria-hidden="true">
        <path d="M2 2h20v4a2 2 0 0 0 0 4v4H2v-4a2 2 0 0 0 0-4z" />
        <path d="M15 3v10" className="cp-cut" />
      </svg>
      {n}{label && <small> كوبون</small>}
    </span>
  );
}
