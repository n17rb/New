import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import ChatView from "../components/ChatView.jsx";

// إدارة موج: محادثة الدعم مع محل معيّن
export default function PlatformSupportThread() {
  const { tenantId } = useParams();
  const [tenant, setTenant] = useState(null);

  return (
    <ChatView
      title={tenant?.name || "..."}
      subtitle={tenant ? [tenant.owner_name, tenant.phone].filter(Boolean).join(" · ") : null}
      avatar={<span className="avatar">{(tenant?.name || "؟").trim().charAt(0)}</span>}
      backTo="/platform?tab=support"
      load={() => api.platformSupportThread(tenantId)}
      onLoaded={(r) => setTenant(r.tenant)}
      isMine={(m) => m.from_support}
      send={(body) => api.platformSupportSend(tenantId, body)}
      sendImage={(file, body) => api.platformSupportImage(tenantId, file, body)}
      markRead={() => api.platformSupportRead(tenantId)}
      emptyText="ما في رسائل مع هالمحل لسا."
    />
  );
}
