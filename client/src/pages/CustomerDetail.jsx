import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, API_ORIGIN } from "../api.js";
import { FiEdit2, FiTrash2, FiCamera, FiImage, FiMapPin, FiArrowRight, FiPlusCircle, FiPhone } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import OrderForm from "../components/OrderForm.jsx";

export default function CustomerDetail({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showOrderForm, setShowOrderForm] = useState(false);

  const canManage = ["super_admin", "admin", "data_entry", "driver"].includes(user.role);
  const canDelete = user.role === "super_admin" || user.role === "admin" || user.can_delete_customer;
  const canOrder = user.role !== "data_entry";

  async function load() {
    setError("");
    try {
      const full = await api.getCustomer(id);
      setCustomer(full);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;
  if (error && !customer) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!customer) return null;

  if (showOrderForm) {
    return (
      <div className="page">
        <OrderForm
          customer={customer}
          user={user}
          onClose={() => setShowOrderForm(false)}
          onCreated={() => setShowOrderForm(false)}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <button className="btn-danger-text icon-row" style={{ marginBottom: 10 }} onClick={() => navigate("/customers")}>
        <FiArrowRight /> رجوع لقائمة العملاء
      </button>

      {error && <div className="error-box">{error}</div>}

      <CustomerHeader customer={customer} canManage={canManage} canDelete={canDelete} onChanged={load} onDeleted={() => navigate("/customers")} />
      <ReminderNoteSection customer={customer} canManage={canManage} onChanged={load} />

      {canOrder && (
        <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={() => setShowOrderForm(true)}>
          <FiPlusCircle /> طلب جديد لهذا العميل
        </button>
      )}

      <LocationSection customer={customer} canManage={canManage} onChanged={load} />
      {canManage && <CustomPricesSection customerId={customer.id} />}
      <OrderHistorySection customerId={customer.id} />
    </div>
  );
}

function CustomerHeader({ customer, canManage, canDelete, onChanged, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone_display);
  const [seq, setSeq] = useState(customer.sequential_number);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const whatsappLink = `https://wa.me/${customer.phone_normalized}`;

  const currentPhotoUrl = customer.building_photo_url
    ? (customer.building_photo_url.startsWith("http") ? customer.building_photo_url : API_ORIGIN + customer.building_photo_url)
    : null;

  function handlePickPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await api.updateCustomer(customer.id, { name, phone, sequential_number: seq });
      if (photoFile) {
        await api.uploadCustomerPhoto(customer.id, photoFile);
      }
      setEditing(false);
      setPhotoFile(null);
      setPhotoPreview(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!confirm(`متأكد إنك بدك تحذف "${customer.name}"؟`)) return;
    api.archiveCustomer(customer.id).then(onDeleted).catch((err) => setError(err.message));
  }

  if (editing) {
    return (
      <div className="card">
        {error && <div className="error-box">{error}</div>}

        {(photoPreview || currentPhotoUrl) && (
          <img
            src={photoPreview || currentPhotoUrl}
            alt="صورة العمارة"
            style={{ width: "100%", borderRadius: 8, marginBottom: 12 }}
          />
        )}
        <div className="icon-row" style={{ marginBottom: 16 }}>
          <label className="btn-secondary icon-row" style={{ justifyContent: "center", flex: 1 }}>
            <FiCamera />
            التقاط صورة
            <input type="file" accept="image/*" capture="environment" onChange={handlePickPhoto} style={{ display: "none" }} />
          </label>
          <label className="btn-secondary icon-row" style={{ justifyContent: "center", flex: 1 }}>
            <FiImage />
            من المعرض
            <input type="file" accept="image/*" onChange={handlePickPhoto} style={{ display: "none" }} />
          </label>
        </div>
        {photoFile && <p className="text-secondary" style={{ marginTop: -10, marginBottom: 16 }}>تم اختيار صورة جديدة — اضغط حفظ لتثبيتها</p>}

        <div className="field">
          <label>اسم العميل</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>رقم الهاتف</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </div>
        <div className="field">
          <label>الرقم التسلسلي</label>
          <input value={seq} onChange={(e) => setSeq(e.target.value)} />
        </div>
        <button className="btn-primary" style={{ marginBottom: 10 }} disabled={saving} onClick={handleSave}>
          {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => { setEditing(false); setPhotoFile(null); setPhotoPreview(null); }}
        >
          إلغاء
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      {error && <div className="error-box">{error}</div>}

      {currentPhotoUrl ? (
        <img src={currentPhotoUrl} alt="صورة العمارة" style={{ width: "100%", borderRadius: 8, marginBottom: 12 }} />
      ) : (
        <p className="text-secondary">لا توجد صورة للعمارة بعد — اضغط تعديل لإضافتها.</p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 className="title-md" style={{ marginBottom: 4 }}>{customer.name}</h2>
          <p className="tabular-num text-secondary" style={{ margin: 0 }}>
            {customer.phone_display} · #{customer.sequential_number}
          </p>
        </div>
        <div className="icon-row">
          <a className="icon-btn whatsapp" href={whatsappLink} target="_blank" rel="noreferrer" title="فتح واتساب">
            <FaWhatsapp size={18} />
          </a>
          <a className="icon-btn" href={`tel:${customer.phone_display}`} title="اتصال">
            <FiPhone size={16} />
          </a>
          {canManage && (
            <button className="icon-btn" onClick={() => setEditing(true)} title="تعديل">
              <FiEdit2 size={16} />
            </button>
          )}
          {canDelete && (
            <button className="icon-btn" style={{ color: "var(--urgent)", borderColor: "#f6cfcb" }} onClick={handleDelete} title="حذف">
              <FiTrash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

async function reverseGeocodeStreet(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    );
    const data = await res.json();
    return data?.address?.road || data?.address?.neighbourhood || null;
  } catch {
    return null;
  }
}

function LocationSection({ customer, canManage, onChanged }) {
  const hasSavedLocation = Boolean(customer.maps_url);
  const [editingLocation, setEditingLocation] = useState(!hasSavedLocation);

  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState(customer.region_id || "");
  const [newRegionName, setNewRegionName] = useState("");
  const [street, setStreet] = useState(customer.street || "");
  const [buildingNumber, setBuildingNumber] = useState(customer.building_number || "");
  const [buildingName, setBuildingName] = useState(customer.building_name || "");
  const [floor, setFloor] = useState(customer.floor || "");
  const [apartment, setApartment] = useState(customer.apartment || "");
  const [side, setSide] = useState(customer.side || "");
  const [accessNotes, setAccessNotes] = useState(customer.access_notes || "");
  const [latitude, setLatitude] = useState(customer.latitude || null);
  const [longitude, setLongitude] = useState(customer.longitude || null);
  const [pastedLink, setPastedLink] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    api.getRegions().then(setRegions).catch(() => {});
  }, []);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError("هذا المتصفح لا يدعم تحديد الموقع.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const confirmed = confirm("هل تريد تأكيد موقعك الحالي كموقع هذا العميل؟");
        if (!confirmed) {
          setLocating(false);
          return;
        }
        setLatitude(lat);
        setLongitude(lng);
        setPastedLink("");

        if (!street.trim()) {
          const detectedStreet = await reverseGeocodeStreet(lat, lng);
          if (detectedStreet) setStreet(detectedStreet);
        }
        setLocating(false);
      },
      (err) => {
        setError("تعذّر تحديد الموقع: " + err.message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function tryParseCoordsFromLink(link) {
    if (!link) return null;

    const dPattern = link.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (dPattern) {
      return { lat: parseFloat(dPattern[1]), lng: parseFloat(dPattern[2]) };
    }

    const commaPattern = link.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (commaPattern) {
      return { lat: parseFloat(commaPattern[1]), lng: parseFloat(commaPattern[2]) };
    }

    return null;
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      let finalRegionId = regionId || null;
      if (newRegionName.trim()) {
        const created = await api.createRegion({ name: newRegionName.trim() });
        finalRegionId = created.id;
      }

      let finalLat = latitude;
      let finalLng = longitude;
      let finalMapsUrl = customer.maps_url;

      if (pastedLink.trim()) {
        finalMapsUrl = pastedLink.trim();
        let parsed = tryParseCoordsFromLink(pastedLink.trim());

        if (!parsed) {
          try {
            const resolved = await api.resolveMapsLink(pastedLink.trim());
            parsed = tryParseCoordsFromLink(resolved.resolved_url);
          } catch {
            // إذا فشل فك الرابط، نحفظ الرابط الأصلي فقط بدون إحداثيات دقيقة
          }
        }

        if (parsed) {
          finalLat = parsed.lat;
          finalLng = parsed.lng;
        }
      } else if (latitude && longitude) {
        finalMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
      }

      await api.updateCustomer(customer.id, {
        region_id: finalRegionId,
        street,
        building_number: buildingNumber,
        building_name: buildingName,
        floor,
        apartment,
        side,
        access_notes: accessNotes,
        latitude: finalLat,
        longitude: finalLng,
        maps_url: finalMapsUrl,
      });

      setSuccess("تم حفظ الموقع والعنوان بنجاح.");
      setEditingLocation(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const mapLink = (latitude && longitude)
    ? `https://www.google.com/maps?q=${latitude},${longitude}`
    : customer.maps_url || null;

  if (!editingLocation) {
    return (
      <div className="card" style={{ position: "relative", paddingTop: mapLink ? 28 : 14 }}>
        {mapLink && (
          <a
            className="icon-btn map"
            href={mapLink}
            target="_blank"
            rel="noreferrer"
            title="فتح الموقع على الخريطة"
            style={{ position: "absolute", top: -12, left: 16, zIndex: 2 }}
          >
            <FiMapPin size={18} />
          </a>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <h2 className="title-md" style={{ margin: 0 }}>الموقع والعنوان</h2>
          {canManage && (
            <button className="icon-btn" onClick={() => setEditingLocation(true)} title="تعديل الموقع">
              <FiEdit2 size={16} />
            </button>
          )}
        </div>
        <p className="text-secondary" style={{ margin: 0, lineHeight: 1.8 }}>
          {customer.region_name && <>المنطقة: {customer.region_name}<br /></>}
          {street && <>الشارع: {street}<br /></>}
          {buildingNumber && <>عمارة: {buildingNumber} {buildingName && `(${buildingName})`}<br /></>}
          {floor && <>الطابق: {floor}<br /></>}
          {apartment && <>شقة: {apartment} {side && `— ${side}`}<br /></>}
          {accessNotes && <>ملاحظة: {accessNotes}</>}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="title-md">الموقع والعنوان</h2>
      {error && <div className="error-box">{error}</div>}
      {success && <div className="success-box">{success}</div>}

      <button
        type="button"
        className="btn-secondary"
        style={{ marginBottom: 10 }}
        onClick={useCurrentLocation}
        disabled={locating}
      >
        {locating ? "جاري تحديد الموقع..." : "📍 أنا عند بيت العميل الآن"}
      </button>

      {latitude && longitude && !pastedLink && (
        <p className="text-secondary tabular-num" style={{ marginTop: -4, marginBottom: 10 }}>
          تم تحديد الموقع ✅
        </p>
      )}

      <div className="field">
        <label>أو الصق رابط موقع Google Maps مباشرة</label>
        <input
          value={pastedLink}
          onChange={(e) => setPastedLink(e.target.value)}
          placeholder="https://maps.google.com/..."
        />
      </div>

      <div className="field">
        <label>المنطقة</label>
        <select value={regionId} onChange={(e) => { setRegionId(e.target.value); setNewRegionName(""); }}>
          <option value="">اختر منطقة...</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>أو أضف منطقة جديدة (اتركه فارغ إذا اخترت من الأعلى)</label>
        <input value={newRegionName} onChange={(e) => setNewRegionName(e.target.value)} placeholder="مثال: الرابية" />
      </div>

      <div className="field-row">
        <div className="field">
          <label>الشارع</label>
          <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="يُملأ تلقائيًا عند تحديد الموقع" />
        </div>
        <div className="field">
          <label>رقم العمارة</label>
          <input value={buildingNumber} onChange={(e) => setBuildingNumber(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>اسم العمارة (اختياري)</label>
        <input value={buildingName} onChange={(e) => setBuildingName(e.target.value)} />
      </div>

      <div className="field-row">
        <div className="field">
          <label>الطابق</label>
          <input value={floor} onChange={(e) => setFloor(e.target.value)} />
        </div>
        <div className="field">
          <label>رقم الشقة</label>
          <input value={apartment} onChange={(e) => setApartment(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>جهة الشقة</label>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className={side === "يمين" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setSide("يمين")}
          >
            يمين
          </button>
          <button
            type="button"
            className={side === "يسار" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setSide("يسار")}
          >
            يسار
          </button>
        </div>
      </div>

      <div className="field">
        <label>وصف الوصول (ملاحظة توضح المكان)</label>
        <textarea rows={2} value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} />
      </div>

      <button className="btn-primary" style={{ marginBottom: 10 }} onClick={handleSave} disabled={saving}>
        {saving ? "جاري الحفظ..." : "حفظ الموقع والعنوان"}
      </button>
      {hasSavedLocation && (
        <button type="button" className="btn-secondary" onClick={() => setEditingLocation(false)}>إلغاء</button>
      )}
    </div>
  );
}

function OrderHistorySection({ customerId }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.getCustomerHistory(customerId).then(setHistory).catch((err) => setError(err.message));
  }, [customerId]);

  if (error) return <div className="card"><div className="error-box">{error}</div></div>;
  if (!history) return null;

  const topProduct = history.product_stats[0];

  return (
    <div className="card">
      <h2 className="title-md">تاريخ الطلبات والاستهلاك</h2>

      <div style={{ lineHeight: 1.9 }}>
        <div>عدد الطلبات الكلي: <strong className="tabular-num">{history.total_orders}</strong></div>
        {history.last_order_at && (
          <div>آخر طلب: <strong className="tabular-num">{new Date(history.last_order_at).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman" })}</strong></div>
        )}
        {history.avg_days_between_orders != null && (
          <div className="text-secondary">
            📊 معدل الطلب تقريبًا: كل <strong className="tabular-num">{history.avg_days_between_orders.toFixed(1)}</strong> يوم
            {topProduct && <> — بمعدل <strong className="tabular-num">{topProduct.avg_quantity_per_order}</strong> من "{topProduct.product_name_snapshot}"</>}
          </div>
        )}
      </div>

      {history.product_stats.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="text-secondary" style={{ marginBottom: 6 }}>المنتجات المعتادة (من الطلبات المسلَّمة):</div>
          {history.product_stats.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
              <span>{p.product_name_snapshot}</span>
              <span className="text-secondary tabular-num">{p.order_count} طلب · معدل {p.avg_quantity_per_order}</span>
            </div>
          ))}
        </div>
      )}

      {history.orders.length > 0 && (
        <>
          <button className="btn-secondary" style={{ marginTop: 14 }} onClick={() => setExpanded(!expanded)}>
            {expanded ? "إخفاء" : "عرض"} كل الطلبات ({history.orders.length})
          </button>

          {expanded && (
            <div style={{ marginTop: 10 }}>
              {history.orders.map((o) => (
                <div key={o.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>#{o.order_number} · {new Date(o.created_at).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman" })}</span>
                    <span className="tabular-num" style={{ fontWeight: 700 }}>{Number(o.final_total).toFixed(2)} JD</span>
                  </div>
                  <div className="text-secondary" style={{ fontSize: "0.85rem" }}>
                    {o.items.map((it) => `${it.product_name_snapshot} ×${it.quantity}`).join("، ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReminderNoteSection({ customer, canManage, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(customer.preferred_delivery_note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await api.updateCustomer(customer.id, { preferred_delivery_note: note });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing && !customer.preferred_delivery_note && !canManage) return null;

  return (
    <div className="card">
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="title-md" style={{ margin: 0 }}>⏰ تذكير التوصيل المعتاد</h2>
        {canManage && !editing && (
          <button className="icon-btn" onClick={() => setEditing(true)} title="تعديل">
            <FiEdit2 size={16} />
          </button>
        )}
      </div>

      {!editing ? (
        <p className="text-secondary" style={{ margin: "8px 0 0" }}>
          {customer.preferred_delivery_note || "لا يوجد ملاحظة — مثال: يحب التوصيل كل أحد وخميس بعد العصر."}
        </p>
      ) : (
        <>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: يحب التوصيل كل أحد وخميس بعد العصر"
            style={{ marginTop: 8 }}
          />
          <button className="btn-primary" style={{ marginTop: 8, marginBottom: 8 }} disabled={saving} onClick={handleSave}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
          <button className="btn-secondary" onClick={() => { setEditing(false); setNote(customer.preferred_delivery_note || ""); }}>إلغاء</button>
        </>
      )}
    </div>
  );
}

function CustomPricesSection({ customerId }) {
  const [prices, setPrices] = useState(null);
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [p, allProducts] = await Promise.all([api.getCustomerPrices(customerId), api.getProducts()]);
      setPrices(p);
      setProducts(allProducts);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [customerId]);

  async function handleAdd() {
    if (!selectedProduct || !customPrice) return;
    setSaving(true);
    setError("");
    try {
      await api.setCustomerPrice(customerId, { product_id: Number(selectedProduct), custom_price: parseFloat(customPrice) });
      setSelectedProduct("");
      setCustomPrice("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(productId) {
    try {
      await api.deleteCustomerPrice(customerId, productId);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!prices) return null;

  return (
    <div className="card">
      <h2 className="title-md">💰 أسعار خاصة لهذا العميل</h2>
      <p className="text-secondary" style={{ marginBottom: 10 }}>تُستخدم تلقائيًا بدل السعر العام عند إنشاء طلب جديد له.</p>
      {error && <div className="error-box">{error}</div>}

      {prices.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
          <span>{p.product_name}</span>
          <div className="icon-row">
            <span className="tabular-num" style={{ fontWeight: 700 }}>{Number(p.custom_price).toFixed(2)} JD</span>
            <span className="text-secondary tabular-num" style={{ fontSize: "0.75rem" }}>(عام: {Number(p.default_price).toFixed(2)})</span>
            <button className="btn-danger-text" style={{ width: "auto", padding: "4px 10px" }} onClick={() => handleRemove(p.product_id)}>حذف</button>
          </div>
        </div>
      ))}

      <div className="field-row" style={{ marginTop: 10 }}>
        <div className="field">
          <label>المنتج</label>
          <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
            <option value="">اختر منتج...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>السعر الخاص (JD)</label>
          <input type="number" step="0.01" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} />
        </div>
      </div>
      <button className="btn-secondary" disabled={saving || !selectedProduct || !customPrice} onClick={handleAdd}>
        {saving ? "جاري الحفظ..." : "+ إضافة سعر خاص"}
      </button>
    </div>
  );
}
