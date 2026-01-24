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

module.exports = router;
