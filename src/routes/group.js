// server/src/routes/groups.js
const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const crypto = require("crypto");

// helper: find user by phone or 404
async function findUserByPhoneOr404(phone, res) {
  const u = await User.findOne({ phone });
  if (!u) {
    res.status(404).json({ message: "User with this phone not found" });
    return null;
  }
  return u;
}

/**
 * POST /api/groups
 * body: { title, description?, membersPhones?: string[] }
 * creates group with current user as admin
 */
router.post("/", auth, async (req, res) => {
  const { title, description, membersPhones = [] } = req.body;
  if (!title?.trim()) return res.status(400).json({ message: "Title required" });

  // unique list of memberIds from phones
  const memberIds = [];
  for (const p of membersPhones) {
    const u = await User.findOne({ phone: p });
    if (u) memberIds.push(String(u._id));
  }
  // include creator
  const all = Array.from(new Set([req.user.id, ...memberIds]));
  const chat = await Chat.create({
    isGroup: true,
    title: title.trim(),
    description: description || "",
    participants: all,
    admins: [req.user.id],
    lastMessage: "Group created",
    lastAt: new Date(),
  });

  res.status(201).json({ id: chat._id });
});

/**
 * PATCH /api/groups/:id
 * body: { title?, description? }
 * only admin
 */
router.patch("/:id", auth, async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: "Group not found" });
  if (!chat.admins.map(String).includes(req.user.id)) return res.status(403).json({ message: "Forbidden" });

  const { title, description } = req.body;
  if (typeof title === "string") chat.title = title;
  if (typeof description === "string") chat.description = description;
  await chat.save();

  res.json({ ok: true });
});

/**
 * POST /api/groups/:id/members
 * body: { phone }
 * admin-only, add member by phone
 */
router.post("/:id/members", auth, async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: "Group not found" });
  if (!chat.admins.map(String).includes(req.user.id)) return res.status(403).json({ message: "Forbidden" });

  const u = await findUserByPhoneOr404(req.body.phone, res);
  if (!u) return;
  chat.participants.addToSet(u._id);
  await chat.save();
  res.json({ ok: true });
});

/**
 * DELETE /api/groups/:id/members
 * body: { phone }
 * admin-only, remove member by phone
 */
router.delete("/:id/members", auth, async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: "Group not found" });
  if (!chat.admins.map(String).includes(req.user.id)) return res.status(403).json({ message: "Forbidden" });

  const u = await findUserByPhoneOr404(req.body.phone, res);
  if (!u) return;

  // cannot remove last admin via this route; and prevent removing self if only admin
  const isAdmin = chat.admins.map(String).includes(String(u._id));
  if (isAdmin && chat.admins.length === 1) {
    return res.status(400).json({ message: "Cannot remove the only admin" });
  }

  chat.participants.pull(u._id);
  chat.admins.pull(u._id);
  await chat.save();

  res.json({ ok: true });
});

/**
 * POST /api/groups/:id/admins
 * body: { phone, promote: boolean }  // promote=true => add admin, false => remove admin
 * admin-only
 */
router.post("/:id/admins", auth, async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat || !chat.isGroup) return res.status(404).json({ message: "Group not found" });
  if (!chat.admins.map(String).includes(req.user.id)) return res.status(403).json({ message: "Forbidden" });

  const { phone, promote } = req.body;
  const u = await findUserByPhoneOr404(phone, res);
  if (!u) return;

  if (!chat.participants.map(String).includes(String(u._id))) {
    return res.status(400).json({ message: "User is not a member" });
  }

  if (promote) chat.admins.addToSet(u._id);
  else {
    if (chat.admins.length === 1 && String(chat.admins[0]) === String(u._id)) {
      return res.status(400).json({ message: "Cannot remove the only admin" });
    }
    chat.admins.pull(u._id);
  }
  await chat.save();
  res.json({ ok: true });
});

/**
 * GET /api/groups/:id
 * returns group with members (minimal info)
 */
router.get("/:id", auth, async (req, res) => {
  const chat = await Chat.findById(req.params.id)
    .populate("participants", "full_name phone")
    .populate("admins", "_id")
    .populate("pendingParticipants", "full_name phone");

  if (!chat || !chat.isGroup) return res.status(404).json({ message: "Group not found" });

  // ✅ After populate, participants are user documents with _id field
  const participantIds = chat.participants.map(p => String(p._id));
  if (!participantIds.includes(req.user.id)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  res.json({
    id: chat._id,
    title: chat.title,
    description: chat.description,
    members: chat.participants.map(p => ({ id: p._id, name: p.full_name, phone: p.phone })),
    admins: chat.admins.map(a => String(a._id)),
    inviteCode: chat.inviteCode,
    pendingParticipants: chat.admins.some(a => String(a._id) === req.user.id)
      ? chat.pendingParticipants.map(p => ({ id: p._id, name: p.full_name, phone: p.phone }))
      : []
  });
});

/**
 * POST /api/groups/:id/leave
 * user leaves the group
 */
router.post("/:id/leave", auth, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat || !chat.isGroup) return res.status(404).json({ message: "Group not found" });

    const userId = req.user.id;
    if (!chat.participants.map(String).includes(userId)) {
      return res.status(400).json({ message: "You are not a member of this group" });
    }

    // Remove from participants and admins
    chat.participants.pull(userId);
    chat.admins.pull(userId);

    // ✅ Admin Succession: if no admins left, promote the oldest member
    if (chat.admins.length === 0 && chat.participants.length > 0) {
      const nextAdminId = chat.participants[0];
      chat.admins.push(nextAdminId);
    }

    await chat.save();
    res.json({ success: true, message: "Left group successfully" });
  } catch (err) {
    console.error("Leave group error:", err);
    res.status(500).json({ message: "Failed to leave group" });
  }
});

router.post("/:id/invite", auth, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat || !chat.isGroup) return res.status(404).json({ message: "Group not found" });

    // Only admins can generate/view invite link
    if (!chat.admins.map(String).includes(req.user.id)) {
      return res.status(403).json({ message: "Only admins can manage invite links" });
    }

    if (!chat.inviteCode) {
      // ✅ Generate 6-digit numeric code
      chat.inviteCode = Math.floor(100000 + Math.random() * 900000).toString();
      await chat.save();
    }

    res.json({ success: true, inviteCode: chat.inviteCode });
  } catch (err) {
    console.error("Invite error:", err);
    res.status(500).json({ message: "Failed to manage invite link" });
  }
});

/**
 * POST /api/groups/join/:inviteCode
 * Join a group using an invite code
 */
router.post("/join/:inviteCode", auth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ inviteCode: req.params.inviteCode });
    if (!chat) return res.status(404).json({ message: "Invalid invite code" });

    const userId = req.user.id;
    if (chat.participants.map(String).includes(userId) || chat.pendingParticipants.map(String).includes(userId)) {
      return res.status(400).json({ message: "You are already a member or pending approval" });
    }

    chat.pendingParticipants.push(userId);
    await chat.save();

    res.json({ success: true, message: "Request sent to admins" });
  } catch (err) {
    console.error("Join group error:", err);
    res.status(500).json({ message: "Failed to join group" });
  }
});

/**
 * POST /api/groups/:id/approve
 * Admin approves or rejects a pending participant
 */
router.post("/:id/approve", auth, async (req, res) => {
  try {
    const { targetUserId, approve } = req.body;
    const chat = await Chat.findById(req.params.id);
    if (!chat || !chat.isGroup) return res.status(404).json({ message: "Group not found" });

    // Only admins can approve
    if (!chat.admins.map(String).includes(req.user.id)) {
      return res.status(403).json({ message: "Only admins can approve requests" });
    }

    if (!chat.pendingParticipants.map(String).includes(targetUserId)) {
      return res.status(400).json({ message: "User is not in pending list" });
    }

    chat.pendingParticipants.pull(targetUserId);

    if (approve === true) {
      chat.participants.addToSet(targetUserId);
    }

    await chat.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Approve error:", err);
    res.status(500).json({ message: "Failed to process request" });
  }
});

module.exports = router;
