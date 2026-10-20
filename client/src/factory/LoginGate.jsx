import { useEffect, useState } from "react";
import { fapi } from "./fapi.js";
import FactoryLogin, { readFactoryLogin, saveFactoryLogin } from "./FactoryLogin.jsx";

// بيقرر شو يطلع: دخول المصنع بشعاره، أو دخول موج العادي
export default function LoginGate({ onLoggedIn, fallback }) {
  const m = window.location.pathname.match(/^\/m\/(\d+)/);
  const [brand, setBrand] = useState(() => (m ? null : readFactoryLogin()));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!m) return;
    fapi.brandFor(m[1]).then((b) => { saveFactoryLogin(b); setBrand(b); }).catch(() => setFailed(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return fallback;
  if (!brand) return <div className="fx" style={{ minHeight: "100vh" }} />;
  return (
    <FactoryLogin
      brand={brand}
      onLoggedIn={onLoggedIn}
      onSwitch={() => { saveFactoryLogin(null); window.location.href = "/"; }}
    />
  );
}
