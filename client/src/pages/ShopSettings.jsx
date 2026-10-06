import ShopLocationCard from "../components/ShopLocationCard.jsx";
import { ViewOnlyNote } from "../auth.jsx";

export default function ShopSettings() {
  return (
    <div className="page">
      <h1 className="title-lg">إعدادات المحل</h1>
      <ViewOnlyNote section="settings" />
      <div className="card">
        <h2 className="title-md">موقع المحل</h2>
        <p className="text-secondary" style={{ marginTop: 0 }}>
          كل رحلة توزيع بتترتب من الأقرب للأبعد وبتخلص بالرجوع لهون.
        </p>
        <ShopLocationCard compact />
      </div>
    </div>
  );
}
