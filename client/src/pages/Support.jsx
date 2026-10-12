import { useState } from "react";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";
import ChatView, { SupportAvatar } from "../components/ChatView.jsx";

// الدعم الفني: محادثة مدير المحل مع إدارة موج
export default function Support() {
  const { user } = usePerms();
  const [support, setSupport] = useState({ name: "دعم موج", photo_url: null });

  return (
    <ChatView
      title={support.name}
      subtitle="الدعم الفني لموج — بنرد عليك بأسرع وقت"
      avatar={<SupportAvatar photo={support.photo_url} />}
      backTo="/more"
      load={api.getSupportThread}
      onLoaded={(r) => r.support && setSupport(r.support)}
      isMine={(m) => !m.from_support}
      send={(body) => api.sendSupportMessage(body)}
      sendImage={(file, body) => api.sendSupportImage(file, body)}
      markRead={() => api.markSupportRead()}
      emptyText="أهلًا فيك 👋 اكتبلنا أي سؤال أو مشكلة، وبتقدر تبعت صورة للشاشة."
      readOnly={!!user?.inspecting}
    />
  );
}
