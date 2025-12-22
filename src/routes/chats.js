// import { Router } from "express";
// import Chat from "../models/Chat.js";
// import User from "../models/User.js";
// import { auth } from "../middleware/auth.js";

const express = require('express')
const Chat = require('../models/Chat')
const User = require('../models/User')
const { auth } = require('../middleware/auth')

const router = express.Router();

// list only chats that current user has messaged (threads)
// router.get("/", auth, async (req, res) => {
//   const chats = await Chat.find({ participants: req.user.id })
//     .sort({ lastAt: -1 })
//     .populate("participants", "full_name phone avatar")
//     .lean();

//   // shape items to show the other participant + preview
//   const formatted = chats.map(c => {
//     const others = c.participants.filter(p => String(p._id) !== req.user.id);
//     const other = others[0]; // one-to-one threads in this starter
//     return {
//       id: c._id,
//       other: { id: other._id, full_name: other.full_name, phone: other.phone, avatar: other.avatar || "" },
//       lastMessage: c.lastMessage || "",
//       lastAt: c.lastAt
//     };
//   });

//   res.json(formatted);
// });

router.get("/", auth, async (req, res) => {
  const userId = req.user.id;
  const chats = await Chat.find({ participants: userId })
    .sort({ lastAt: -1 })
    .populate("participants", "full_name phone avatar isOnline lastSeen publicKey email about")
    .lean();

  const shaped = chats
    .map(c => {
      const others = c.participants.filter(p => p && String(p._id) !== userId);
      const other = c.isGroup ? null : others[0];

      // Skip non-group chats without a valid other participant
      if (!c.isGroup && !other) return null;

      // Filter out hidden chats unless explicitly requested (handled by frontend logic usually)
      const isHidden = (c.hiddenBy || []).map(String).includes(userId);
      if (isHidden) return null;

      const unreadCount = Number(c.unread?.[userId] || 0);
      const pinned = (c.pinnedBy || []).map(String).includes(userId);
      const isArchived = (c.archivedBy || []).map(String).includes(userId);

      return {
        id: c._id,
        isGroup: c.isGroup,
        title: c.isGroup ? c.title : (other?.full_name || other?.phone),
        description: c.isGroup ? c.description : undefined,
        admins: c.isGroup ? (c.admins || []).map(String) : undefined,
        other: c.isGroup ? undefined : {
          id: other._id, full_name: other.full_name, phone: other.phone,
          avatar: other.avatar, isOnline: other.isOnline, lastSeen: other.lastSeen,
          publicKey: other.publicKey, email: other.email, about: other.about
        },
        lastMessage: c.lastMessage,
        lastAt: c.lastAt,
        lastEncryptedBody: c.lastEncryptedBody,
        lastEncryptedKeys: c.lastEncryptedKeys,
        unread: unreadCount,
        pinned,
        isArchived
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.lastAt) - new Date(a.lastAt));

  res.json(shaped);
});

// open a chat by phone (create if missing, unhide/unarchive)
router.post("/open", auth, async (req, res) => {
  const { targetPhone } = req.body;
  const target = await User.findOne({ phone: targetPhone });
  if (!target) return res.status(404).json({ message: "Target not found" });
  if (String(target._id) === req.user.id) return res.status(400).json({ message: "Cannot chat with yourself" });

  let chat = await Chat.findOne({ participants: { $all: [req.user.id, target._id] } });
  if (!chat) {
    chat = await Chat.create({ participants: [req.user.id, target._id] });
  } else {
    // Re-opening an existing chat should un-hide and un-archive it
    await Chat.updateOne(
      { _id: chat._id },
      {
        $pull: {
          hiddenBy: req.user.id,
          archivedBy: req.user.id
        }
      }
    );
  }

  res.json({
    id: chat._id,
    other: {
      id: target._id,
      full_name: target.full_name,
      phone: target.phone,
      publicKey: target.publicKey,
      email: target.email,
      about: target.about
    }
  });
});

// Archive / Unarchive
router.post("/:id/archive", auth, async (req, res) => {
  const { archive } = req.body; // true to archive, false to unarchive
  const operator = archive ? '$addToSet' : '$pull';
  await Chat.updateOne({ _id: req.params.id }, { [operator]: { archivedBy: req.user.id } });
  res.json({ success: true, isArchived: archive });
});

// Hide / Delete (Mark messages as deleted for user)
router.post("/:id/hide", auth, async (req, res) => {
  const chatId = req.params.id;
  const userId = req.user.id;

  // 1. Mark chat as hidden
  await Chat.updateOne({ _id: chatId }, { $addToSet: { hiddenBy: userId } });

  // 2. Mark all messages in this chat as deleted for this user
  const Message = require('../models/Message');
  await Message.updateMany(
    { chat: chatId, deletedFor: { $ne: userId } },
    { $addToSet: { deletedFor: userId } }
  );

  res.json({ success: true });
});

// export default router;

module.exports = router
