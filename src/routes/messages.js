// // import { Router } from "express";
// // import Message from "../models/Message.js";
// // import Chat from "../models/Chat.js";
// // import { auth } from "../middleware/auth.js";


// const express = require('express')
// const Chat = require('../models/Chat')
// const Message = require('../models/Message')
// const {auth} = require('../middleware/auth')

// const router = express.Router();

// // history
// // router.get("/:chatId", auth, async (req, res) => {
// //   const chat = await Chat.findById(req.params.chatId);
// //   if (!chat || !chat.participants.map(String).includes(req.user.id))
// //     return res.status(403).json({ message: "Forbidden" });

// //   const msgs = await Message.find({ chat: req.params.chatId }).sort({ createdAt: 1 }).lean();
// //   res.json(msgs);
// // });


// router.get("/:chatId", auth, async (req, res) => {
//   const userId = req.user.id;
//   const chat = await Chat.findById(req.params.chatId);
//   if (!chat || !chat.participants.map(String).includes(userId)) return res.sendStatus(403);

//   const msgs = await Message.find({ chat: chat._id })
//     .sort({ createdAt: 1 }).lean();

//   const visible = msgs.map(m => {
//     // mask deletes
//     if (m.deletedForEveryone || (m.deletedFor || []).map(String).includes(userId)) {
//       return { ...m, body: "This message was deleted.", deleted: true, attachments: [] };
//     }
//     return m;
//   });

//   res.json(visible);
// });


// // export default router;

// module.exports = router


const express = require("express");
const Chat = require("../models/Chat");
const Message = require("../models/Message");
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
  if (!chat || !chat.participants.map(String).includes(userId))
    return res.sendStatus(403);

  // Fetch messages sorted by time, populate sender info for group chats
  const msgs = await Message.find({ chat: chatId })
    .populate("sender", "full_name phone avatar")
    .populate({
      path: "replyTo",
      select: "body sender attachments",
      populate: { path: "sender", select: "full_name phone" }
    })
    .populate("forwardedFrom.originalSender", "full_name phone")
    .populate("reactions.user", "full_name phone")
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
