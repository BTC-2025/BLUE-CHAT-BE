// const {Server} = require("socket.io")
// const User = require("./models/User.js")
// const Chat = require("./models/Chat.js")
// const Message = require("./models/Message.js")
// const PendingDelivery = require("./models/PendingDelivery.js")

// // memory map socket->user
// const onlineUsers = new Map(); // socketId -> { userId }
// const userRooms = new Map();   // userId -> Set(chatIds)

// const mountIO = (httpServer, corsOrigin) => {
//   const io = new Server(httpServer, { cors: { origin: corsOrigin } });

//   io.use(async (socket, next) => {
//     const { userId } = socket.handshake.auth || {};
//     if (!userId) return next(new Error("unauthorized"));
//     socket.data.userId = userId;
//     next();
//   });

//   io.on("connection", async (socket) => {
//     const userId = socket.data.userId;
//     onlineUsers.set(socket.id, { userId });

//     await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
//     io.emit("presence:update", { userId, isOnline: true });

//     const chats = await Chat.find({ participants: userId }).select("_id").lean();
//     const rooms = new Set(chats.map(c => String(c._id)));
//     userRooms.set(userId, rooms);
//     rooms.forEach(r => socket.join(r));

//     socket.on("typing:start", ({ chatId }) =>
//       socket.to(chatId).emit("typing:started", { chatId, userId })
//     );

//     socket.on("typing:stop", ({ chatId }) =>
//       socket.to(chatId).emit("typing:stopped", { chatId, userId })
//     );

//     socket.on("message:send", async ({ chatId, body, attachments }) => {
//       const msg = await Message.create({
//         chat: chatId,
//         sender: userId,
//         body,
//         attachments: attachments || [],
//       });

//       const chat = await Chat.findById(chatId);
//       chat.lastMessage = body || (attachments?.length ? "[attachment]" : "");
//       chat.lastAt = msg.createdAt;

//       chat.participants.forEach((p) => {
//         const pid = String(p);
//         if (pid !== userId) {
//           const current = Number(chat.unread.get(pid) || 0);
//           chat.unread.set(pid, current + 1);
//         }
//       });
//       await chat.save();

//       const deliveredTo = [];
//       const room = io.sockets.adapter.rooms.get(chatId);

//       for (const p of chat.participants) {
//         const pid = String(p);
//         if (pid === userId) continue;

//         const inRoom = room && room.size > 0;
//         if (inRoom) deliveredTo.push(pid);
//         else await PendingDelivery.create({ user: pid, message: msg._id });
//       }

//       if (deliveredTo.length) {
//         msg.status = "delivered";
//         msg.deliveredTo = deliveredTo;
//         await msg.save();
//       }

//       io.to(chatId).emit("message:new", msg);
//       io.to(chatId).emit("chats:update", {
//         chatId,
//         lastMessage: chat.lastMessage,
//         lastAt: chat.lastAt,
//       });
//     });

//     socket.on("message:readAll", async ({ chatId }) => {
//       await Message.updateMany(
//         { chat: chatId, readBy: { $ne: userId } },
//         { $addToSet: { readBy: userId }, $set: { status: "seen" } }
//       );

//       const chat = await Chat.findById(chatId);
//       chat.unread.set(userId, 0);
//       await chat.save();

//       io.to(chatId).emit("message:readReceipt", { chatId, reader: userId });
//       io.to(chatId).emit("chats:update", { chatId, unreadResetFor: userId });
//     });

//     socket.on("message:delete", async ({ messageId, forEveryone }) => {
//       const msg = await Message.findById(messageId);
//       if (!msg) return;

//       const chat = await Chat.findById(msg.chat);
//       const isAdmin = chat.admins.map(String).includes(userId);

//       if (forEveryone) {
//         if (String(msg.sender) !== userId && !isAdmin) return;
//         msg.deletedForEveryone = true;
//       } else {
//         msg.deletedFor.addToSet(userId);
//       }
//       await msg.save();

//       io.to(String(msg.chat)).emit("message:deleted", { messageId, forEveryone });
//     });

//     socket.on("chat:pin", async ({ chatId, pin }) => {
//       const chat = await Chat.findById(chatId);
//       if (!chat) return;

//       if (pin) chat.pinnedBy.addToSet(userId);
//       else chat.pinnedBy.pull(userId);

//       await chat.save();
//       socket.emit("chat:pinned", { chatId, pin });
//     });

//     socket.on("group:create", async ({ title, description, participants }) => {
//       const unique = Array.from(new Set([userId, ...participants]));

//       const chat = await Chat.create({
//         isGroup: true,
//         title,
//         description,
//         participants: unique,
//         admins: [userId],
//         lastMessage: "Group created",
//         lastAt: new Date(),
//       });

//       socket.emit("group:created", { chatId: chat._id });
//     });

//     socket.on("group:add", async ({ chatId, memberId }) => {
//       const chat = await Chat.findById(chatId);
//       if (!chat || !chat.admins.map(String).includes(userId)) return;

//       chat.participants.addToSet(memberId);
//       await chat.save();
//       io.to(chatId).emit("group:updated");
//     });

//     socket.on("group:remove", async ({ chatId, memberId }) => {
//       const chat = await Chat.findById(chatId);
//       if (!chat || !chat.admins.map(String).includes(userId)) return;

//       chat.participants.pull(memberId);
//       chat.admins.pull(memberId);
//       await chat.save();
//       io.to(chatId).emit("group:updated");
//     });

//     socket.on("group:promote", async ({ chatId, memberId }) => {
//       const chat = await Chat.findById(chatId);
//       if (!chat || !chat.admins.map(String).includes(userId)) return;

//       chat.admins.addToSet(memberId);
//       await chat.save();
//       io.to(chatId).emit("group:updated");
//     });

//     socket.on("group:broadcast", async ({ chatId, body }) => {
//       socket.emit("message:send", { chatId, body });
//     });

//     socket.on("user:sync", async () => {
//       const pending = await PendingDelivery.find({ user: userId })
//         .populate("message")
//         .lean();

//       if (pending.length) {
//         pending.forEach((p) => socket.emit("message:new", p.message));
//         await PendingDelivery.deleteMany({ user: userId });
//       }
//     });

//     socket.on("disconnect", async () => {
//       onlineUsers.delete(socket.id);

//       const stillOnline = Array.from(onlineUsers.values()).some(
//         (u) => u.userId === userId
//       );

//       if (!stillOnline) {
//         await User.findByIdAndUpdate(userId, {
//           isOnline: false,
//           lastSeen: new Date(),
//         });

//         io.emit("presence:update", { userId, isOnline: false });
//       }
//     });

//     // when a user opens a chat, mark all as read for them
//     socket.on("message:readAll", async ({ chatId }) => {
//       const userId = socket.data.userId;

//       // mark all messages in this chat as seen by this user
//       await Message.updateMany(
//         { chat: chatId, readBy: { $ne: userId } },
//         { $addToSet: { readBy: userId }, $set: { status: "seen" } }
//       );

//       // reset unread counter for this user in the chat
//       const chat = await Chat.findById(chatId);
//       if (chat) {
//         chat.unread.set(userId, 0);
//         await chat.save();
//       }

//       // notify both panes: chat window (for ticks) and sidebar (for badge)
//       io.to(chatId).emit("message:readReceipt", { chatId, reader: userId });
//       io.emit("chats:update", { chatId, unreadResetFor: userId }); // sidebar listeners will set badge=0
//     });

//   });

//   return io;
// };

// // ✅ ✅ ADD THIS LINE
// module.exports = { mountIO };



const { Server } = require("socket.io");
const User = require("./models/User.js");
const Chat = require("./models/Chat.js");
const Message = require("./models/Message.js");
const PendingDelivery = require("./models/PendingDelivery.js");

// memory maps
const onlineUsers = new Map(); // socketId -> { userId }
const userRooms = new Map();   // userId -> Set(chatIds)

const mountIO = (httpServer, corsOrigin) => {
  // ✅ Support multiple origins
  const origins = corsOrigin?.split(',') || ['http://localhost:3000'];
  const io = new Server(httpServer, {
    cors: {
      origin: origins,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    const { userId } = socket.handshake.auth || {};
    if (!userId) return next(new Error("unauthorized"));

    // ✅ Check if account is disabled
    try {
      const user = await User.findById(userId).select("isDisabled");
      if (!user) return next(new Error("User not found"));
      if (user.isDisabled) return next(new Error("Account disabled"));

      socket.data.userId = String(userId);
      next();
    } catch (err) {
      next(new Error("Auth error"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId;
    onlineUsers.set(socket.id, { userId });

    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
    io.emit("presence:update", { userId, isOnline: true });

    const chats = await Chat.find({ participants: userId }).select("_id").lean();
    const rooms = new Set(chats.map(c => String(c._id)));
    userRooms.set(userId, rooms);
    rooms.forEach(r => socket.join(r));
    socket.join(String(userId)); // ✅ Join private user room

    // Typing
    socket.on("typing:start", ({ chatId }) =>
      socket.to(chatId).emit("typing:started", { chatId, userId })
    );
    socket.on("typing:stop", ({ chatId }) =>
      socket.to(chatId).emit("typing:stopped", { chatId, userId })
    );

    // Send message
    socket.on("message:send", async ({ chatId, body, attachments, replyTo, encryptedBody, encryptedKeys, scheduledAt }) => {
      const chat = await Chat.findById(chatId);
      if (!chat) return;

      // ✅ Check if blocked (for 1:1 chats only)
      if (!chat.isGroup) {
        const otherUserId = chat.participants.find(p => String(p) !== userId);
        if (otherUserId) {
          const sender = await User.findById(userId);
          const recipient = await User.findById(otherUserId);

          // Check if sender blocked recipient OR recipient blocked sender
          const senderBlocked = sender?.blockedUsers?.map(String).includes(String(otherUserId));
          const recipientBlocked = recipient?.blockedUsers?.map(String).includes(String(userId));

          if (senderBlocked) {
            socket.emit("message:error", { error: "You have blocked this user. Unblock to send messages." });
            return;
          }
          if (recipientBlocked) {
            socket.emit("message:error", { error: "You cannot send messages to this user." });
            return;
          }
        }
      }

      // ✅ Determine if this is a scheduled message
      // Trust the presence of scheduledAt, even if clocks are slightly out of sync
      const isScheduled = !!scheduledAt;

      let msg = await Message.create({
        chat: chatId,
        sender: userId,
        body,
        attachments: attachments || [],
        replyTo: replyTo || null,
        encryptedBody: encryptedBody || null,
        encryptedKeys: encryptedKeys || [],
        scheduledAt: isScheduled ? new Date(scheduledAt) : null,
        isReleased: !isScheduled
      });

      // ✅ Populate sender info and replyTo for clients
      msg = await Message.findById(msg._id)
        .populate("sender", "full_name phone avatar")
        .populate({
          path: "replyTo",
          select: "body sender attachments",
          populate: { path: "sender", select: "full_name phone" }
        })
        .lean();

      // If scheduled, stop here (sender gets confirmation, receiver gets nothing yet)
      if (isScheduled) {
        return socket.emit("message:scheduled", {
          message: msg,
          chatId,
          scheduledAt: msg.scheduledAt
        });
      }

      // Prepare atomic update for chat metadata
      const room = io.sockets.adapter.rooms.get(chatId);
      const userIdsInRoom = new Set();
      if (room) {
        for (const sid of room) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.userId) userIdsInRoom.add(String(s.data.userId));
        }
      }

      const updateData = {
        $set: {
          lastMessage: body || (attachments?.length ? "[attachment]" : ""),
          lastAt: msg.createdAt,
          lastEncryptedBody: encryptedBody || null,
          lastEncryptedKeys: encryptedKeys || []
        },
        $pull: {
          hiddenBy: { $in: Array.from(userIdsInRoom) }, // Unhide for those in room
          archivedBy: { $in: Array.from(userIdsInRoom) }
        }
      };

      // Atomic unread increments for participants NOT in the room
      const updateQuery = { _id: chatId };
      const incData = {};
      const deliveredTo = [];

      for (const p of chat.participants) {
        const pid = String(p);
        if (pid === userId) continue;

        if (userIdsInRoom.has(pid)) {
          deliveredTo.push(pid);
          // If in room, also ensure it's not hidden/archived for them
          // (Handled by the $pull in updateData above)
        } else {
          // Recipient NOT in room => increment unread atomically
          incData[`unread.${pid}`] = 1;
          await PendingDelivery.create({ user: pid, message: msg._id });
        }
      }

      if (Object.keys(incData).length > 0) {
        updateData.$inc = incData;
      }

      // Perform atomic update
      await Chat.findByIdAndUpdate(chatId, updateData);

      if (deliveredTo.length) {
        await Message.findByIdAndUpdate(msg._id, {
          status: "delivered",
          deliveredTo: deliveredTo,
        });
        msg.status = "delivered";
        msg.deliveredTo = deliveredTo;
      }

      io.to(chatId).emit("message:new", msg);

      // ✅ Also emit to each participant's private room to ensure real-time discovery
      chat.participants.forEach(p => {
        io.to(String(p)).emit("message:new", msg);
      });

      io.to(chatId).emit("chats:update", {
        chatId,
        lastMessage: chat.lastMessage,
        lastAt: chat.lastAt,
      });
    });

    // Mark all messages read in a chat
    socket.on("message:readAll", async ({ chatId }) => {
      try {
        await Message.updateMany(
          { chat: chatId, readBy: { $ne: userId } },
          { $addToSet: { readBy: userId }, $set: { status: "seen" } }
        );

        const chat = await Chat.findById(chatId);
        if (chat) {
          chat.unread.set(userId, 0);
          await chat.save();
        }

        io.to(chatId).emit("message:readReceipt", { chatId, reader: userId });
        io.emit("chats:update", { chatId, unreadResetFor: userId });
      } catch (err) {
        console.error("message:readAll error", err);
      }
    });

    // Delete message (for me / for everyone)
    socket.on("message:delete", async ({ messageId, forEveryone }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const chat = await Chat.findById(msg.chat);
        if (!chat) return;

        const isAdmin = (chat.admins || []).map(String).includes(userId);
        const isSender = String(msg.sender) === userId;

        if (forEveryone) {
          // Only sender or admin can delete for everyone
          if (!isSender && !isAdmin) return;
          msg.deletedForEveryone = true;
          await msg.save();

          // notify entire chat - use chat._id for consistent room naming
          const roomId = String(chat._id);
          io.to(roomId).emit("message:deleted:everyone", {
            messageId,
            chatId: roomId
          });
        } else {
          // delete only for current user
          msg.deletedFor.addToSet(userId);
          await msg.save();

          // notify ONLY this user's sockets
          socket.emit("message:deleted:me", {
            messageId,
            chatId: String(msg.chat)
          });
        }
      } catch (err) {
        console.error("message:delete error", err);
      }
    });

    // ✅ Add/remove emoji reaction
    socket.on("message:react", async ({ messageId, emoji }, callback) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return callback?.({ success: false, error: "Message not found" });

        // Check if user already has ANY reaction
        const existingReactionIndex = msg.reactions.findIndex(
          r => String(r.user) === userId
        );

        if (existingReactionIndex >= 0) {
          const existingReaction = msg.reactions[existingReactionIndex];

          if (existingReaction.emoji === emoji) {
            // Same emoji => Toggle off (remove)
            msg.reactions.splice(existingReactionIndex, 1);
          } else {
            // Different emoji => Replace
            msg.reactions[existingReactionIndex].emoji = emoji;
          }
        } else {
          // No existing reaction => Add new
          msg.reactions.push({ emoji, user: userId });
        }

        await msg.save();

        // Emit to all users in the chat
        io.to(String(msg.chat)).emit("message:reacted", {
          messageId,
          reactions: msg.reactions
        });

        callback?.({ success: true });
      } catch (err) {
        console.error("message:react error:", err);
        callback?.({ success: false, error: err.message });
      }
    });

    // Pin chat
    socket.on("chat:pin", async ({ chatId, pin }) => {
      const chat = await Chat.findById(chatId);
      if (!chat) return;
      if (pin) chat.pinnedBy.addToSet(userId);
      else chat.pinnedBy.pull(userId);
      await chat.save();
      socket.emit("chat:pinned", { chatId, pin });
    });

    // Group management
    socket.on("group:create", async ({ title, description, participants }, callback) => {
      try {
        // ✅ Convert phone numbers → user IDs
        const users = await User.find({ phone: { $in: participants } }).select("_id");

        const mappedIds = users.map((u) => String(u._id));

        // ✅ Include creator
        const unique = Array.from(new Set([userId, ...mappedIds]));

        const chat = await Chat.create({
          isGroup: true,
          title,
          description,
          participants: unique,        // ✅ now ObjectId array
          admins: [userId],
          lastMessage: "Group created",
          lastAt: new Date(),
        });

        // ✅ Notify creator
        socket.emit("group:created", { chatId: chat._id });

        if (callback) callback({ success: true });
      } catch (err) {
        console.error("Group create error:", err);
        if (callback) callback({ success: false, error: err.message });
      }
    });


    socket.on("group:add", async ({ chatId, memberId }) => {
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.admins.map(String).includes(userId)) return;
      chat.participants.addToSet(memberId);
      await chat.save();
      io.to(chatId).emit("group:updated");
    });

    socket.on("group:remove", async ({ chatId, memberId }) => {
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.admins.map(String).includes(userId)) return;
      chat.participants.pull(memberId);
      chat.admins.pull(memberId);
      await chat.save();
      io.to(chatId).emit("group:updated");
    });

    socket.on("group:promote", async ({ chatId, memberId }) => {
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.admins.map(String).includes(userId)) return;
      chat.admins.addToSet(memberId);
      await chat.save();
      io.to(chatId).emit("group:updated");
    });

    // Broadcast via bot/shortcut
    socket.on("group:broadcast", async ({ chatId, body }) => {
      socket.emit("message:send", { chatId, body });
    });

    // Deliver pending
    socket.on("user:sync", async () => {
      const pending = await PendingDelivery.find({ user: userId })
        .populate("message")
        .lean();

      if (pending.length) {
        pending.forEach((p) => socket.emit("message:new", p.message));
        await PendingDelivery.deleteMany({ user: userId });
      }
    });

    // Disconnect
    socket.on("disconnect", async () => {
      onlineUsers.delete(socket.id);

      const stillOnline = Array.from(onlineUsers.values()).some(
        (u) => u.userId === userId
      );

      if (!stillOnline) {
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
        });
        io.emit("presence:update", { userId, isOnline: false });
      }
    });

    // in server/src/socket.js where you handle group:* events
    socket.on("group:add", async ({ chatId, memberPhone }) => {
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.admins.map(String).includes(userId)) return;
      const user = await User.findOne({ phone: memberPhone });
      if (!user) return;
      chat.participants.addToSet(user._id);
      await chat.save();
      io.to(chatId).emit("group:updated", { chatId });
    });

    socket.on("group:remove", async ({ chatId, memberPhone }) => {
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.admins.map(String).includes(userId)) return;
      const user = await User.findOne({ phone: memberPhone });
      if (!user) return;

      if (chat.admins.length === 1 && String(chat.admins[0]) === String(user._id)) return; // enforce rule
      chat.participants.pull(user._id);
      chat.admins.pull(user._id);
      await chat.save();
      io.to(chatId).emit("group:updated", { chatId });
    });


    // ✅ Block user
    socket.on("user:block", async ({ targetUserId }, callback) => {
      try {
        await User.findByIdAndUpdate(userId, {
          $addToSet: { blockedUsers: targetUserId }
        });
        socket.emit("user:blocked", { targetUserId });

        // ✅ Notify the blocked user in real-time
        io.emit("user:blockedBy", { blockedBy: userId, targetUserId });

        if (callback) callback({ success: true });
      } catch (err) {
        console.error("Block error:", err);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // ✅ Unblock user
    socket.on("user:unblock", async ({ targetUserId }, callback) => {
      try {
        await User.findByIdAndUpdate(userId, {
          $pull: { blockedUsers: targetUserId }
        });
        socket.emit("user:unblocked", { targetUserId });

        // ✅ Notify the unblocked user in real-time
        io.emit("user:unblockedBy", { unblockedBy: userId, targetUserId });

        if (callback) callback({ success: true });
      } catch (err) {
        console.error("Unblock error:", err);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // ✅ Check if user is blocked
    socket.on("user:checkBlocked", async ({ targetUserId }, callback) => {
      try {
        const currentUser = await User.findById(userId);
        const targetUser = await User.findById(targetUserId);

        const iBlockedThem = currentUser?.blockedUsers?.map(String).includes(String(targetUserId));
        const theyBlockedMe = targetUser?.blockedUsers?.map(String).includes(String(userId));

        if (callback) callback({
          success: true,
          iBlockedThem,
          theyBlockedMe,
          isBlocked: iBlockedThem || theyBlockedMe
        });
      } catch (err) {
        console.error("Check blocked error:", err);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // ✅ Pin a message
    socket.on("message:pin", async ({ messageId, chatId }, callback) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return callback?.({ success: false, error: "Chat not found" });

        // Check admin permission for groups
        if (chat.isGroup && !chat.admins.map(String).includes(userId)) {
          return callback?.({ success: false, error: "Only admins can pin messages" });
        }

        const message = await Message.findByIdAndUpdate(
          messageId,
          { isPinned: true, pinnedBy: userId, pinnedAt: new Date() },
          { new: true }
        ).populate("sender", "full_name phone");

        io.to(chatId).emit("message:pinned", { chatId, message });
        callback?.({ success: true, message });
      } catch (err) {
        console.error("Pin message error:", err);
        callback?.({ success: false, error: err.message });
      }
    });

    // ✅ Unpin a message
    socket.on("message:unpin", async ({ messageId, chatId }, callback) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return callback?.({ success: false, error: "Chat not found" });

        // Check admin permission for groups
        if (chat.isGroup && !chat.admins.map(String).includes(userId)) {
          return callback?.({ success: false, error: "Only admins can unpin messages" });
        }

        await Message.findByIdAndUpdate(messageId, {
          isPinned: false,
          pinnedBy: null,
          pinnedAt: null
        });

        io.to(chatId).emit("message:unpinned", { chatId, messageId });
        callback?.({ success: true });
      } catch (err) {
        console.error("Unpin message error:", err);
        callback?.({ success: false, error: err.message });
      }
    });

    // ✅ Pin a chat (for current user)
    socket.on("chat:pin", async ({ chatId }, callback) => {
      try {
        await Chat.findByIdAndUpdate(chatId, {
          $addToSet: { pinnedBy: userId }
        });
        socket.emit("chat:pinned", { chatId });
        callback?.({ success: true });
      } catch (err) {
        console.error("Pin chat error:", err);
        callback?.({ success: false, error: err.message });
      }
    });

    // ✅ Unpin a chat (for current user)
    socket.on("chat:unpin", async ({ chatId }, callback) => {
      try {
        await Chat.findByIdAndUpdate(chatId, {
          $pull: { pinnedBy: userId }
        });
        socket.emit("chat:unpinned", { chatId });
        callback?.({ success: true });
      } catch (err) {
        console.error("Unpin chat error:", err);
        callback?.({ success: false, error: err.message });
      }
    });

    // ══════════════════════════════════════════════
    // ✅ FORWARD MESSAGE
    // ══════════════════════════════════════════════
    socket.on("message:forward", async ({ messageId, targetChatId }, callback) => {
      try {
        const originalMsg = await Message.findById(messageId);
        if (!originalMsg) {
          return callback?.({ success: false, error: "Message not found" });
        }

        const targetChat = await Chat.findById(targetChatId);
        if (!targetChat || !targetChat.participants.map(String).includes(userId)) {
          return callback?.({ success: false, error: "Cannot forward to this chat" });
        }

        // Create forwarded message
        let newMsg = await Message.create({
          chat: targetChatId,
          sender: userId,
          body: originalMsg.body,
          attachments: originalMsg.attachments || [],
          forwardedFrom: {
            originalSender: originalMsg.sender,
            originalChat: originalMsg.chat
          }
        });

        // Populate for clients
        newMsg = await Message.findById(newMsg._id)
          .populate("sender", "full_name phone avatar")
          .populate("forwardedFrom.originalSender", "full_name phone")
          .lean();

        // Update chat lastMessage
        targetChat.lastMessage = originalMsg.body || "[forwarded]";
        targetChat.lastAt = newMsg.createdAt;
        await targetChat.save();

        // Emit to target chat room
        io.to(String(targetChatId)).emit("message:new", newMsg);
        io.emit("chats:update", {
          chatId: targetChatId,
          lastMessage: targetChat.lastMessage,
          lastAt: targetChat.lastAt,
        });

        callback?.({ success: true });
      } catch (err) {
        console.error("Forward message error:", err);
        callback?.({ success: false, error: err.message });
      }
    });

    // ══════════════════════════════════════════════
    // ✅ VIDEO/AUDIO CALL SIGNALING
    // ══════════════════════════════════════════════

    // Initiate a call
    socket.on("call:initiate", async ({ targetUserId, callType }, callback) => {
      try {
        // Find target user's socket
        let targetSocketId = null;
        for (const [socketId, userData] of onlineUsers.entries()) {
          if (userData.userId === targetUserId) {
            targetSocketId = socketId;
            break;
          }
        }

        if (!targetSocketId) {
          return callback?.({ success: false, error: "User is offline" });
        }

        // Get caller info
        const caller = await User.findById(userId).select("full_name phone avatar");

        // Send incoming call to target
        io.to(targetSocketId).emit("call:incoming", {
          callerId: userId,
          callerName: caller?.full_name || caller?.phone || "Unknown",
          callerAvatar: caller?.avatar,
          callType // "video" or "audio"
        });

        callback?.({ success: true });
      } catch (err) {
        console.error("Call initiate error:", err);
        callback?.({ success: false, error: err.message });
      }
    });

    // Accept incoming call
    socket.on("call:accept", async ({ callerId }) => {
      // Find caller's socket
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === callerId) {
          io.to(socketId).emit("call:accepted", { recipientId: userId });
          break;
        }
      }
    });

    // Reject incoming call
    socket.on("call:reject", async ({ callerId }) => {
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === callerId) {
          io.to(socketId).emit("call:rejected", { recipientId: userId });
          break;
        }
      }
    });

    // WebRTC offer
    socket.on("call:offer", ({ targetUserId, offer }) => {
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === targetUserId) {
          io.to(socketId).emit("call:offer", { callerId: userId, offer });
          break;
        }
      }
    });

    // WebRTC answer
    socket.on("call:answer", ({ targetUserId, answer }) => {
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === targetUserId) {
          io.to(socketId).emit("call:answer", { recipientId: userId, answer });
          break;
        }
      }
    });

    // ICE candidate exchange
    socket.on("call:ice-candidate", ({ targetUserId, candidate }) => {
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === targetUserId) {
          io.to(socketId).emit("call:ice-candidate", { senderId: userId, candidate });
          break;
        }
      }
    });

    // End call
    socket.on("call:end", ({ targetUserId }) => {
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === targetUserId) {
          io.to(socketId).emit("call:ended", { endedBy: userId });
          break;
        }
      }
    });

  });

  return io;
};

module.exports = { mountIO };
