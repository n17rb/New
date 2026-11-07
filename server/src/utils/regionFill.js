import { query } from "../db.js";

// زبون منطقته مش معروفة بس إله موقع: بناخذ منطقة أقرب زبون إله منطقة
// (المسافة تقريبية — خط العرض بعمّان ≈ ٣٢°، فخط الطول بينضرب بـ ٠٫٨٥)
export async function fillMissingRegions(customerId = null) {
  const r = await query(
    `UPDATE customer_locations l SET region_id = n.region_id, updated_at = now()
     FROM (
       SELECT x.id, (
         SELECT k.region_id FROM customer_locations k
         WHERE k.region_id IS NOT NULL AND k.latitude IS NOT NULL AND k.longitude IS NOT NULL AND k.id <> x.id
         ORDER BY (k.latitude - x.latitude) ^ 2 + ((k.longitude - x.longitude) * 0.85) ^ 2
         LIMIT 1
       ) AS region_id
       FROM customer_locations x
       WHERE x.region_id IS NULL AND x.latitude IS NOT NULL AND x.longitude IS NOT NULL
         AND ($1::int IS NULL OR x.customer_id = $1::int)
     ) n
     WHERE l.id = n.id AND n.region_id IS NOT NULL`,
    [customerId]
  );
  return r.rowCount || 0;
}
