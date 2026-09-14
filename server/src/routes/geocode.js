import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.post("/resolve-link", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "الرابط مطلوب." });

  try {
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    res.json({ resolved_url: response.url });
  } catch (err) {
    res.status(400).json({ error: "تعذّر فتح الرابط للتحقق من الإحداثيات." });
  }
});

export default router;
