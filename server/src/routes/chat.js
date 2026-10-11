import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAction } from "../permissions.js";
import { uploadSingleImage, saveCompressedImage } from "../middleware/upload.js";
import { sendPushToUser } from "../utils/push.js";

// ============================================================
// شات الموظفين مع الإدارة
// كل موظف إله محادثة وحدة مع «الإدارة». اللي عنده صلاحية «صندوق رسائل الموظفين»
// بيشوف كل المحادثات وبيرد باسم الإدارة.
// ============================================================

const router = Router();
router.use(requireAuth);

const isInbox = (user) => can(user, "chat", "view");
const canReply = (user) => can(user, "chat", "edit");
const canChatWithAdmin = (user) => canAction(user, "chat_with_admin");

function canAccessThread(user, threadUserId) {
  if (isInbox(user)) return true;
  return threadUserId === user.id && canChatWithAdmin(user);
}

async function inboxUsers() {
  const result = await query(
    `SELECT id, role, permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE status = 'active'`
  );
  return result.rows.filter((u) => can(u, "chat", "view"));
}

const MESSAGE_COLUMNS = `m.id, m.thread_user_id, m.sender_id, m.body, m.image_url, m.read_at, m.created_at,
  u.full_name AS sender_name, (m.sender_id = m.thread_user_id) AS from_staff`;

// شو بشوف المستخدم: صندوق الإدارة، أو محادثته هو بس
router.get("/me", async (req, res) => {
  res.json({
    inbox: isInbox(req.user),
    can_reply: canReply(req.user),
    can_chat_with_admin: canChatWithAdmin(req.user),
  });
});

// عدد الرسائل اللي ما انقرت (للجرس)
router.get("/unread", async (req, res) => {
  let count = 0;
  if (isInbox(req.user)) {
    const r = await query(
      "SELECT COUNT(*)::int AS n FROM staff_messages WHERE sender_id = thread_user_id AND read_at IS NULL AND thread_user_id <> $1",
      [req.user.id]
    );
    count += r.rows[0].n;
  }
  if (canChatWithAdmin(req.user)) {
    const r = await query(
      "SELECT COUNT(*)::int AS n FROM staff_messages WHERE thread_user_id = $1 AND sender_id IS DISTINCT FROM $1 AND read_at IS NULL",
      [req.user.id]
    );
    count += r.rows[0].n;
  }
  res.json({ count });
});

// صندوق الإدارة: كل المحادثات، آخر رسالة وعدد اللي ما انقرت
router.get("/threads", async (req, res) => {
  if (!isInbox(req.user)) return res.status(403).json({ error: "ما عندك صلاحية صندوق رسائل الموظفين." });
  const result = await query(
    `SELECT u.id AS user_id, u.full_name, u.role, u.status,
            last.body AS last_body, last.image_url AS last_image, last.created_at AS last_at,
            (last.sender_id = u.id) AS last_from_staff,
            (SELECT COUNT(*)::int FROM staff_messages m
              WHERE m.thread_user_id = u.id AND m.sender_id = u.id AND m.read_at IS NULL) AS unread
     FROM users u
     JOIN LATERAL (
       SELECT body, image_url, created_at, sender_id FROM staff_messages
       WHERE thread_user_id = u.id ORDER BY id DESC LIMIT 1
     ) last ON true
     WHERE u.id <> $1
     ORDER BY last.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// الموظفين اللي بقدر أبدأ معهم محادثة (للإدارة)
router.get("/staff", async (req, res) => {
  if (!canReply(req.user)) return res.status(403).json({ error: "غير مصرح." });
  const result = await query(
    `SELECT id, full_name, role FROM users WHERE status = 'active' AND id <> $1 ORDER BY full_name`,
    [req.user.id]
  );
  res.json(result.rows);
});

// رسائل محادثة. ?after=ID بيرجّع الجديد بس (للتحديث السريع)
router.get("/thread/:userId", async (req, res) => {
  const threadUserId = Number(req.params.userId);
  if (!canAccessThread(req.user, threadUserId)) return res.status(403).json({ error: "غير مصرح." });

  const after = Number(req.query.after) || 0;
  const before = Number(req.query.before) || 0;
  const params = [threadUserId];
  let where = "m.thread_user_id = $1";
  if (after) {
    params.push(after);
    where += ` AND m.id > $${params.length}`;
  } else if (before) {
    params.push(before);
    where += ` AND m.id < $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM (
       SELECT ${MESSAGE_COLUMNS} FROM staff_messages m LEFT JOIN users u ON u.id = m.sender_id
       WHERE ${where} ORDER BY m.id DESC LIMIT 60
     ) t ORDER BY id ASC`,
    params
  );
  const peer = (await query("SELECT id, full_name, role FROM users WHERE id = $1", [threadUserId])).rows[0] || null;
  res.json({ peer, messages: result.rows, has_more: !after && result.rows.length === 60 });
});

async function notifyNewMessage({ threadUserId, senderId, senderName, text }) {
  const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : "📷 صورة";
  if (senderId === threadUserId) {
    // من موظف ← للإدارة
    for (const u of await inboxUsers()) {
      if (u.id === senderId) continue;
      sendPushToUser(u.id, { title: `💬 ${senderName}`, body: preview, url: `/chat/${threadUserId}`, tag: `chat-${threadUserId}` })
        .catch(() => {});
    }
  } else {
    // من الإدارة ← للموظف
    sendPushToUser(threadUserId, { title: "💬 الإدارة", body: preview, url: "/chat", tag: "chat-admin" }).catch(() => {});
  }
}

async function insertMessage(req, res, { body, imageUrl }) {
  const threadUserId = Number(req.params.userId);
  if (!canAccessThread(req.user, threadUserId)) return res.status(403).json({ error: "غير مصرح." });
  const fromStaff = threadUserId === req.user.id;
  if (!fromStaff && !canReply(req.user)) return res.status(403).json({ error: "صلاحيتك على صندوق الرسائل مشاهدة فقط." });

  const text = String(body || "").trim().slice(0, 2000) || null;
  if (!text && !imageUrl) return res.status(400).json({ error: "اكتب رسالة." });

  const exists = await query("SELECT id FROM users WHERE id = $1", [threadUserId]);
  if (!exists.rows[0]) return res.status(404).json({ error: "الموظف غير موجود." });

  const inserted = (await query(
    `INSERT INTO staff_messages (thread_user_id, sender_id, body, image_url) VALUES ($1, $2, $3, $4) RETURNING id`,
    [threadUserId, req.user.id, text, imageUrl || null]
  )).rows[0];
  const message = (await query(
    `SELECT ${MESSAGE_COLUMNS} FROM staff_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
    [inserted.id]
  )).rows[0];

  res.status(201).json(message);
  notifyNewMessage({ threadUserId, senderId: req.user.id, senderName: req.user.full_name, text }).catch(() => {});
}

router.post("/thread/:userId", async (req, res) => insertMessage(req, res, { body: req.body?.body }));

router.post("/thread/:userId/image", uploadSingleImage, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "اختار صورة." });
  const threadUserId = Number(req.params.userId);
  if (!canAccessThread(req.user, threadUserId)) return res.status(403).json({ error: "غير مصرح." });
  const url = await saveCompressedImage(req.file.buffer, `chat-${threadUserId}`);
  return insertMessage(req, res, { body: req.body?.body, imageUrl: url });
});

// تعليم الرسائل كمقروءة (رسائل الطرف الثاني)
router.post("/thread/:userId/read", async (req, res) => {
  const threadUserId = Number(req.params.userId);
  if (!canAccessThread(req.user, threadUserId)) return res.status(403).json({ error: "غير مصرح." });
  const fromStaffSide = threadUserId === req.user.id;
  await query(
    fromStaffSide
      ? "UPDATE staff_messages SET read_at = now() WHERE thread_user_id = $1 AND sender_id IS DISTINCT FROM $1 AND read_at IS NULL"
      : "UPDATE staff_messages SET read_at = now() WHERE thread_user_id = $1 AND sender_id = $1 AND read_at IS NULL",
    [threadUserId]
  );
  res.json({ ok: true });
});

// حذف رسالة: صاحبها خلال ١٠ دقايق
router.delete("/message/:id", async (req, res) => {
  const msg = (await query("SELECT * FROM staff_messages WHERE id = $1", [req.params.id])).rows[0];
  if (!msg) return res.status(404).json({ error: "الرسالة غير موجودة." });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: "بتقدر تحذف رسائلك إنت بس." });
  if (Date.now() - new Date(msg.created_at).getTime() > 10 * 60 * 1000) {
    return res.status(400).json({ error: "ما بتقدر تحذف رسالة صار إلها أكثر من ١٠ دقايق." });
  }
  await query("DELETE FROM staff_messages WHERE id = $1", [msg.id]);
  await logActivity({ userId: req.user.id, action: "DELETE_CHAT_MESSAGE", recordType: "chat", recordId: msg.id });
  res.json({ ok: true });
});

export default router;
