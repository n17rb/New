import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireFactory } from "./lib.js";
import core from "./core.js";
import customers from "./customers.js";
import orders from "./orders.js";
import driver from "./driver.js";
import stock from "./stock.js";
import money from "./money.js";
import reports from "./reports.js";
import publicRoutes from "./public.js";
import sample from "./sample.js";
import recurring from "./recurring.js";
import jard from "./jard.js";
import corrections from "./corrections.js";
import maint from "./maint.js";
import store from "./store.js";
import postpone from "./postpone.js";
import line from "./line.js";
import books from "./books.js";

// ============================================================
// موج للمصانع — كل مسارات المصنع تحت /api/factory
// ============================================================
const router = Router();
router.use(requireAuth, requireFactory);
router.use(postpone);
router.use(core);
router.use(customers);
router.use(orders);
router.use(driver);
router.use(stock);
router.use(money);
router.use(reports);
router.use(sample);
router.use(recurring);
router.use(jard);
router.use(corrections);
router.use(maint);
router.use(store);
router.use(line);
router.use(books);

export const factoryPublicRouter = publicRoutes;
export { factoryWatch } from "./reports.js";
export default router;
