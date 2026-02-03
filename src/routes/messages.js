const express = require("express");
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");

const router = express.Router();

/**
 * ✅ GET MESSAGES OF A CHAT
 * Returns messages with deletion masking (for me / for everyone)
 */
router.get("/:chatId", auth, async (req, res) => {
  const userId = req.user.id;
  const chatId = req.params.chatId;

  const chat = await Chat.findById(chatId);
  if (!chat) return res.sendStatus(404);

  // Check direct participation OR community access
  let hasAccess = chat.participants.map(String).includes(userId);

  if (!hasAccess && chat.community) {
    // If it's a community group (announcement or subgroup), check if user is in any group of that community
    // This allows members of linked groups to see announcement messages
    const community = await mongoose.model("Community").findById(chat.community);
    if (community) {
      if (community.members.map(String).includes(userId)) {
        hasAccess = true;
      } else {
        // Deeper check: is user in ANY group of this community?
        const userInGroups = await Chat.exists({
          _id: { $in: community.groups },
          participants: userId
        });
        if (userInGroups) hasAccess = true;
      }
    }
  }

  console.log(`[DEBUG] GET /messages/${chatId} - User: ${userId}, Access: ${hasAccess}, Community: ${chat.community}`);

  if (!hasAccess) return res.sendStatus(403);

  // Fetch messages sorted by time, populate sender info for group chats
  // ✅ ENFORCE RELEASE FILTER: Recipients should NOT see scheduled messages before release.
  // We use { $ne: false } to ensure older messages (which don't have this field) are still visible.
  const msgs = await Message.find({
    chat: chatId,
    deletedFor: { $ne: userId },
    $or: [
      { isReleased: { $ne: false } },
      { sender: userId }
    ],
    // ✅ Privacy Filter: If visibleTo is set, user must be in it. Empty visibleTo means public.
    $and: [
      {
        $or: [
          { visibleTo: { $exists: false } },
          { visibleTo: { $size: 0 } },
          { visibleTo: userId }
        ]
      }
    ]
  })
    .populate("sender", "full_name phone avatar")
    .populate({
      path: "replyTo",
      select: "body sender attachments",
      populate: { path: "sender", select: "full_name phone" }
    })
    .populate("forwardedFrom.originalSender", "full_name phone")
    .populate("reactions.user", "full_name phone")
    .populate({
      path: "task",
      populate: [
        { path: "assignees.user", select: "full_name phone avatar" },
        { path: "assignedBy", select: "full_name phone" }
      ]
    })
    .sort({ createdAt: 1 })
    .lean();

  // ✅ Apply deletion masking (same rules as the client)
  const processed = msgs.map((m) => {
    const deletedForMe =
      Array.isArray(m.deletedFor) &&
      m.deletedFor.map(String).includes(String(userId));

    // DELETE FOR EVERYONE
    if (m.deletedForEveryone) {
      return {
        ...m,
        body: "This message was deleted",
        isDeletedForEveryone: true,
        attachments: [],
      };
    }

    // DELETE ONLY FOR ME
    if (deletedForMe) {
      return {
        ...m,
        body: "",               // frontend will hide it
        isDeletedForMe: true,
        attachments: [],
      };
    }

    // NORMAL MESSAGE
    return m;
  });

  res.json(processed);
});

/**
 * ✅ POST /api/messages
 * Send a new message
 */
router.post("/", auth, async (req, res) => {
  try {
    const { chatId, content, type = "text", replyTo, tempId, task } = req.body;
    const senderId = req.user.id;

    if (!chatId || !content) {
      return res.status(400).json({ message: "Chat ID and content are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    // Check participation
    const isParticipant = chat.participants.map(String).includes(senderId);
    if (!isParticipant) {
      return res.status(403).json({ message: "Not a participant" });
    }

    // Create Message
    const newMessage = await Message.create({
      chat: chatId,
      sender: senderId,
      body: content, // Schema uses 'body', client sent 'content'
      type,
      replyTo,
      task,
      isReleased: true, // Direct send is always released
      createdAt: new Date()
    });

    // Update Chat
    chat.lastMessage = type === 'text' ? content : `Sent a ${type}`;
    chat.lastAt = new Date();
    // Reset unread for others, increment for them
    chat.participants.forEach(p => {
      const pid = String(p);
      if (pid !== senderId) {
        chat.unread = chat.unread || {};
        chat.unread.set(pid, (chat.unread.get(pid) || 0) + 1);
      }
    });
    await chat.save();

    // Populate for response
    await newMessage.populate([
      { path: "sender", select: "full_name phone avatar" },
      { path: "replyTo", select: "body sender" }
    ]);

    // Socket Emit
    const io = req.app.get("io");
    if (io) {
      const msgData = {
        ...newMessage.toObject(),
        tempId // return tempId for optimistic UI correlation
      };

      chat.participants.forEach(p => {
        io.to(String(p)).emit("message:new", msgData);
      });

      // Also emit to chat room if used
      io.to(chatId).emit("message:new", msgData);
    }

    res.status(201).json(newMessage);
  } catch (err) {
    console.error("Send Message Error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
