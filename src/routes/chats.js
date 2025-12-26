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
    .populate("participants", "full_name phone avatar isOnline lastSeen publicKey email about reportedBy")
    .lean();

  const shaped = chats
    .map(c => {
      const others = c.participants.filter(p => p && String(p._id) !== userId);
      let other = c.isGroup ? null : others[0];
      const isSelfChat = !c.isGroup && others.length === 0;

      if (isSelfChat) {
        // Self-chat: Use the user themselves as "other"
        other = c.participants.find(p => p && String(p._id) === userId);
      }

      // Skip non-group chats without a valid other participant (unless it's a self-chat)
      if (!c.isGroup && !other) return null;

      // Filter out hidden chats unless explicitly requested (handled by frontend logic usually)
      const isHidden = (c.hiddenBy || []).map(String).includes(userId);
      if (isHidden) return null;

      const unreadCount = Number(c.unread?.[userId] || 0);
      const pinned = (c.pinnedBy || []).map(String).includes(userId);
      const isArchived = (c.archivedBy || []).map(String).includes(userId);
      const userClearedAt = c.clearedAt?.[userId] ? new Date(c.clearedAt[userId]) : null;

      // Mask last message if it was cleared by the user
      const isCleared = userClearedAt && c.lastAt && new Date(c.lastAt) <= userClearedAt;

      return {
        id: c._id,
        isGroup: c.isGroup,
        title: c.isGroup ? c.title : (isSelfChat ? "Me" : (other?.full_name || other?.phone)),
        description: c.isGroup ? c.description : undefined,
        admins: c.isGroup ? (c.admins || []).map(String) : undefined,
        other: c.isGroup ? undefined : {
          id: other._id, full_name: other.full_name, phone: other.phone,
          avatar: other.avatar, isOnline: other.isOnline, lastSeen: other.lastSeen,
          publicKey: other.publicKey, email: other.email, about: other.about,
          isReportedByMe: (other.reportedBy || []).map(String).includes(userId)
        },
        lastMessage: isCleared ? "" : c.lastMessage,
        lastAt: isCleared ? null : c.lastAt,
        lastEncryptedBody: isCleared ? null : c.lastEncryptedBody,
        lastEncryptedKeys: isCleared ? [] : c.lastEncryptedKeys,
        unread: unreadCount,
        isPinned: pinned,
        isArchived: isArchived,
        isSelfChat: isSelfChat
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.lastAt) - new Date(a.lastAt));

  res.json(shaped);
});

// ✅ Fetch single chat metadata
router.get("/:id", auth, async (req, res) => {
  const userId = req.user.id;
  const chat = await Chat.findById(req.params.id)
    .populate("participants", "full_name phone avatar isOnline lastSeen publicKey email about reportedBy")
    .lean();

  if (!chat || !chat.participants.some(p => String(p._id) === userId)) {
    return res.status(404).json({ message: "Chat not found" });
  }

  const others = chat.participants.filter(p => p && String(p._id) !== userId);
  const other = chat.isGroup ? null : others[0];

  const unreadCount = Number(chat.unread?.[userId] || 0);
  const pinned = (chat.pinnedBy || []).map(String).includes(userId);
  const isArchived = (chat.archivedBy || []).map(String).includes(userId);

  res.json({
    id: chat._id,
    isGroup: chat.isGroup,
    title: chat.isGroup ? chat.title : (others.length === 0 ? "Me" : (other?.full_name || other?.phone)),
    description: chat.isGroup ? chat.description : undefined,
    admins: chat.isGroup ? (chat.admins || []).map(String) : undefined,
    other: chat.isGroup ? undefined : {
      id: other?._id, full_name: other?.full_name, phone: other?.phone,
      avatar: other?.avatar, isOnline: other?.isOnline, lastSeen: other?.lastSeen,
      publicKey: other?.publicKey, email: other?.email, about: other?.about,
      isReportedByMe: (other?.reportedBy || []).map(String).includes(userId)
    },
    lastMessage: chat.lastMessage,
    lastAt: chat.lastAt,
    lastEncryptedBody: chat.lastEncryptedBody,
    lastEncryptedKeys: chat.lastEncryptedKeys,
    unread: unreadCount,
    isPinned: pinned,
    isArchived: isArchived,
    isSelfChat: others.length === 0
  });
});

// open a chat by phone (create if missing, unhide/unarchive)
router.post("/open", auth, async (req, res) => {
  const { targetPhone } = req.body;
  const target = await User.findOne({ phone: targetPhone });
  if (!target) return res.status(404).json({ message: "Target not found" });
  // if (String(target._id) === req.user.id) return res.status(400).json({ message: "Cannot chat with yourself" });

  // Use $size: 1 for self-chats, or standard $all for 2-participant chats
  let query = {
    isGroup: false,
    participants: { $all: [req.user.id, target._id] }
  };

  if (String(target._id) === req.user.id) {
    query.participants = { $size: 1, $all: [req.user.id] };
  }

  let chat = await Chat.findOne(query);
  if (!chat) {
    chat = await Chat.create({
      isGroup: false,
      participants: String(target._id) === req.user.id ? [req.user.id] : [req.user.id, target._id]
    });
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

  const isSelfChat = String(target._id) === req.user.id;
  res.json({
    id: chat._id,
    title: isSelfChat ? "Me" : (target.full_name || target.phone),
    isSelfChat: isSelfChat,
    other: {
      id: target._id,
      full_name: target.full_name,
      phone: target.phone,
      avatar: target.avatar,
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

// Clear Chat (Mark all messages as deleted for user without hiding chat)
router.post("/:id/clear", auth, async (req, res) => {
  const chatId = req.params.id;
  const userId = req.user.id;

  // Update clearedAt timestamp for this user
  await Chat.findByIdAndUpdate(chatId, {
    $set: { [`clearedAt.${userId}`]: new Date() }
  });

  const Message = require('../models/Message');
  await Message.updateMany(
    { chat: chatId, deletedFor: { $ne: userId } },
    { $addToSet: { deletedFor: userId } }
  );

  res.json({ success: true });
});

// export default router;

module.exports = router
