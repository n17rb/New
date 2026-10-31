import { useEffect, useState } from "react";
import { FiCamera, FiImage, FiCheck } from "react-icons/fi";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";
import Sheet from "./Sheet.jsx";
import LocationPicker from "./LocationPicker.jsx";

// تعديل بيانات الزبون من جوّا الرحلة: صورة البيت، الموقع، تفاصيل البيت (والاسم والتلفون لمين إله صلاحية)
// c = بيانات الزبون (من توقف الرحلة): customer_id, customer_name, phone_display, latitude, ...
export default function CustomerEditSheet({ open, c, onClose, onSaved }) {
  const perms = usePerms();
  const canEditIdentity = perms.canEdit("customers");
  const [loc, setLoc] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoOk, setPhotoOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !c) { setLoc(null); return; }
    setLoc({
      latitude: c.latitude ?? null,
      longitude: c.longitude ?? null,
      maps_url: c.maps_url || null,
      region_id: c.region_id || null,
      region_name: c.region_name || "",
      governorate: c.governorate || "",
      street: c.street || "",
      building_number: c.building_number || "",
      building_name: c.building_name || "",
      floor: c.floor || "",
      apartment: c.apartment || "",
      side: /مصعد/.test(c.side || "") ? (/يمين/.test(c.side) ? "يمين المصعد" : "شمال المصعد") : /يمين/.test(c.side || "") ? "يمين" : /شمال|يسار/.test(c.side || "") ? "يسار" : (c.side || ""),
      access_notes: c.access_notes || "",
    });
    setName(c.customer_name || "");
    setPhone(c.phone_display || "");
    setPhoto(c.building_photo_url || null);
    setPhotoOk(false);
    setError("");
  }, [open, c?.customer_id]);

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhoto(URL.createObjectURL(file));
    setPhotoBusy(true);
    setPhotoOk(false);
    setError("");
    try {
      const r = await api.uploadCustomerPhoto(c.customer_id, file);
      if (r?.photoUrl) setPhoto(r.photoUrl);
      setPhotoOk(true);
      onSaved?.();
    } catch (err) {
      setError(`ما انحفظت الصورة: ${err.message}`);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (!loc) return;
      const body = {
        latitude: loc.latitude ?? undefined,
        longitude: loc.longitude ?? undefined,
        maps_url: loc.maps_url || undefined,
        region_id: loc.region_id || undefined,
        region_name: loc.region_id ? undefined : loc.region_name || undefined,
        governorate: loc.governorate || undefined,
        street: loc.street ?? "",
        building_number: loc.building_number ?? "",
        building_name: loc.building_name ?? "",
        floor: loc.floor ?? "",
        apartment: loc.apartment ?? "",
        side: loc.side ?? "",
        access_notes: loc.access_notes ?? "",
      };
      if (canEditIdentity) {
        if (name.trim() && name.trim() !== c.customer_name) body.name = name.trim();
        if (phone.trim() && phone.trim() !== c.phone_display) body.phone = phone.trim();
      }
      await api.updateCustomer(c.customer_id, body);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!c) return null;

  return (
    <Sheet open={open} title={`تعديل بيانات ${c.customer_name}`} onClose={onClose}>
      <div className="sheet-label" style={{ marginTop: 0 }}>صورة البيت</div>
      <div className="ce-photo">
        {photo ? <img src={photo} alt="صورة البيت" /> : <div className="ce-photo-empty">ما في صورة للبيت لسا</div>}
      </div>
      <div className="ce-photo-btns">
        <label>
          <FiCamera aria-hidden="true" /> {photoBusy ? "جاري الرفع…" : "صوّر هلّق"}
          <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} disabled={photoBusy} />
        </label>
        <label>
          <FiImage aria-hidden="true" /> من الصور
          <input type="file" accept="image/*" onChange={pickPhoto} disabled={photoBusy} />
        </label>
      </div>
      {photoOk && <div className="ce-ok"><FiCheck aria-hidden="true" /> انحفظت الصورة</div>}

      {canEditIdentity && (
        <div className="loc-two" style={{ marginBottom: 12 }}>
          <label className="loc-field">
            <span>الاسم</span>
            <input className="ce-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="loc-field">
            <span>التلفون</span>
            <input className="ce-input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" />
          </label>
        </div>
      )}

      {loc && <LocationPicker value={loc} onChange={setLoc} alwaysDetails title="موقع البيت" optional={false} />}

      {error && <div className="error-box">{error}</div>}

      <div className="sheet-actions">
        <button className="btn-primary" disabled={saving || photoBusy} onClick={save}>
          {saving ? "جاري الحفظ…" : "حفظ التعديلات"}
        </button>
        <button className="btn-secondary" disabled={saving} onClick={onClose}>إلغاء</button>
      </div>
    </Sheet>
  );
}
