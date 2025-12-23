// import { Router } from "express";
// import User from "../models/User.js";
// import { auth } from "../middleware/auth.js";


const express = require('express')
const User = require('../models/User')
const Chat = require('../models/Chat')
const Message = require('../models/Message')
const Status = require('../models/Status')
const { auth } = require('../middleware/auth')

const router = express.Router();

// search by phone to start chat
router.get("/search/:phone", auth, async (req, res) => {
  const u = await User.findOne({ phone: req.params.phone });
  if (!u) return res.status(404).json({ message: "User not found" });
  res.json({ id: u._id, phone: u.phone, full_name: u.full_name, avatar: u.avatar, publicKey: u.publicKey });
});

router.get("/me", auth, async (req, res) => {
  const me = await User.findById(req.user.id).select("-password_hash").lean();
  res.json(me);
});

// ✅ Fetch blocked users list
router.get("/blocked", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate("blockedUsers", "full_name phone avatar about");
    res.json(user.blockedUsers || []);
  } catch (err) {
    console.error("Fetch blocked list error:", err);
    res.status(500).json({ message: "Failed to fetch blocked users" });
  }
});

router.patch("/me", auth, async (req, res) => {
  const { full_name, about, avatar, email } = req.body;
  const me = await User.findByIdAndUpdate(req.user.id, { full_name, about, avatar, email }, { new: true }).select("-password_hash");
  res.json(me);
});

// ✅ Profile update endpoint (for ProfileModal)
router.put("/profile", auth, async (req, res) => {
  const { full_name, avatar, email, about } = req.body;
  const me = await User.findByIdAndUpdate(
    req.user.id,
    { full_name, avatar, email, about },
    { new: true }
  ).select("-password_hash");
  res.json(me);
});

router.patch("/update-public-key", auth, async (req, res) => {
  const { publicKey } = req.body;
  const user = await User.findByIdAndUpdate(req.user.id, { publicKey }, { new: true }).select("-password_hash");
  res.json(user);
});

// ✅ Update Message Retention Setting
router.patch("/retention", auth, async (req, res) => {
  const { days } = req.body;
  try {
    const user = await User.findByIdAndUpdate(req.user.id, { messageRetentionDays: days }, { new: true }).select("-password_hash");
    res.json({ success: true, messageRetentionDays: user.messageRetentionDays });
  } catch (err) {
    res.status(500).json({ message: "Failed to update retention setting" });
  }
});

// ✅ DELETE ACCOUNT (Dangerous!)
router.delete("/me", auth, async (req, res) => {
  const userId = req.user.id;
  try {
    // 1. Find all chats participanting the user
    const userChats = await Chat.find({ participants: userId });

    for (const chat of userChats) {
      if (!chat.isGroup) {
        // 1:1 Chat => Delete messages and the chat itself
        await Message.deleteMany({ chat: chat._id });
        await Chat.findByIdAndDelete(chat._id);
      } else {
        // Group Chat => Remove user from participants and admins
        chat.participants.pull(userId);
        chat.admins.pull(userId);

        if (chat.participants.length === 0) {
          // If no one left, delete messages and the group
          await Message.deleteMany({ chat: chat._id });
          await Chat.findByIdAndDelete(chat._id);
        } else {
          // If others remain, just save the removal
          await chat.save();
          // Optionally delete only THIS user's messages in the group?
          // The request says "deleted including the chats, messages...", 
          // usually we keep group history but remove the user.
          // Let's delete this user's messages in group to be thorough about "delete everything".
          await Message.deleteMany({ chat: chat._id, sender: userId });
        }
      }
    }

    // 2. Delete all statuses
    await Status.deleteMany({ user: userId });

    // 3. Delete any orphaned messages (just in case)
    await Message.deleteMany({ sender: userId });

    // 4. Finally, delete the user
    await User.findByIdAndDelete(userId);

    res.json({ success: true, message: "Account deleted successfully" });
  } catch (err) {
    console.error("Account deletion error:", err);
    res.status(500).json({ message: "Failed to delete account" });
  }
});


// Report User
router.post("/:id/report", auth, async (req, res) => {
  const targetId = req.params.id;
  const reporterId = req.user.id;

  if (targetId === reporterId) {
    return res.status(400).json({ message: "You cannot report yourself" });
  }

  try {
    const user = await User.findByIdAndUpdate(
      targetId,
      { $addToSet: { reportedBy: reporterId } },
      { new: true }
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    // Auto-disable if 3 or more reports
    if (user.reportedBy.length >= 5 && !user.isDisabled) {
      user.isDisabled = true;
      await user.save();

      // ✅ Notify user via socket
      const io = req.app.get("io");
      if (io) {
        io.to(String(targetId)).emit("account:disabled");
      }
    }

    res.json({ success: true, message: "User reported successfully" });
  } catch (err) {
    console.error("Report user error:", err);
    res.status(500).json({ message: "Failed to report user" });
  }
});


// export default router;

module.exports = router

