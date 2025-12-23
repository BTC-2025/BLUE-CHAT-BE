const { Server } = require("socket.io");
const User = require("./models/User.js");
const Chat = require("./models/Chat.js");
const Message = require("./models/Message.js");
const PendingDelivery = require("./models/PendingDelivery.js");
const Call = require("./models/Call.js");
const webpush = require("web-push");

// ✅ Configure web-push
webpush.setVapidDetails(
  "mailto:btcfashion25@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// memory maps
const onlineUsers = new Map(); // socketId -> { userId }
const userRooms = new Map();   // userId -> Set(chatIds)

// ✅ Helper: Send Push Notification
const sendPush = async (targetUserId, payload) => {
  try {
    const user = await User.findById(targetUserId).select("pushSubscriptions");
    if (!user || !user.pushSubscriptions.length) return;

    const pushPayload = JSON.stringify(payload);

    const promises = user.pushSubscriptions.map(sub =>
      webpush.sendNotification(sub, pushPayload).catch(err => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Remove expired subscription
          User.findByIdAndUpdate(targetUserId, { $pull: { pushSubscriptions: sub } }).exec();
        }
        console.error("Push error:", err.message);
      })
    );
    await Promise.all(promises);
  } catch (err) {
    console.error("Global push error:", err);
  }
};

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

      // If scheduled, stop here
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
          hiddenBy: { $in: Array.from(userIdsInRoom) },
          archivedBy: { $in: Array.from(userIdsInRoom) }
        }
      };

      const incData = {};
      const deliveredTo = [];

      for (const p of chat.participants) {
        const pid = String(p);
        if (pid === userId) continue;

        if (userIdsInRoom.has(pid)) {
          deliveredTo.push(pid);
        } else {
          incData[`unread.${pid}`] = 1;
          await PendingDelivery.create({ user: pid, message: msg._id });
        }
      }

      if (Object.keys(incData).length > 0) {
        updateData.$inc = incData;
      }

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
      chat.participants.forEach(p => {
        io.to(String(p)).emit("message:new", msg);
      });

      io.to(chatId).emit("chats:update", {
        chatId,
        lastMessage: chat.lastMessage,
        lastAt: chat.lastAt,
      });

      // ✅ Send Push Notification to others
      const sender = await User.findById(userId).select("full_name phone");
      const senderName = sender?.full_name || sender?.phone || "Someone";

      chat.participants.forEach(async (p) => {
        const pid = String(p);
        if (pid === userId) return;

        const room = io.sockets.adapter.rooms.get(chatId);
        const isRecipientInRoom = Array.from(room || []).some(sid => onlineUsers.get(sid)?.userId === pid);

        if (!isRecipientInRoom) {
          sendPush(pid, {
            title: chat.isGroup ? chat.title : senderName,
            body: chat.isGroup ? `${senderName}: ${chat.lastMessage}` : chat.lastMessage,
            icon: "/logo192.png",
            data: { chatId }
          });
        }
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

    // Delete message
    socket.on("message:delete", async ({ messageId, forEveryone }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;

        const chat = await Chat.findById(msg.chat);
        if (!chat) return;

        const isAdmin = (chat.admins || []).map(String).includes(userId);
        const isSender = String(msg.sender) === userId;

        if (forEveryone) {
          if (!isSender && !isAdmin) return;
          msg.deletedForEveryone = true;
          await msg.save();

          const roomId = String(chat._id);
          io.to(roomId).emit("message:deleted:everyone", {
            messageId,
            chatId: roomId
          });
        } else {
          msg.deletedFor.addToSet(userId);
          await msg.save();
          socket.emit("message:deleted:me", {
            messageId,
            chatId: String(msg.chat)
          });
        }
      } catch (err) {
        console.error("message:delete error", err);
      }
    });

    // ✅ Emoji reaction
    socket.on("message:react", async ({ messageId, emoji }, callback) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return callback?.({ success: false, error: "Message not found" });

        const existingReactionIndex = msg.reactions.findIndex(
          r => String(r.user) === userId
        );

        if (existingReactionIndex >= 0) {
          const existingReaction = msg.reactions[existingReactionIndex];
          if (existingReaction.emoji === emoji) {
            msg.reactions.splice(existingReactionIndex, 1);
          } else {
            msg.reactions[existingReactionIndex].emoji = emoji;
          }
        } else {
          msg.reactions.push({ emoji, user: userId });
        }

        await msg.save();
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

    // Group creation
    socket.on("group:create", async ({ title, description, participants }, callback) => {
      try {
        const users = await User.find({ phone: { $in: participants } }).select("_id");
        const mappedIds = users.map((u) => String(u._id));
        const unique = Array.from(new Set([userId, ...mappedIds]));

        const chat = await Chat.create({
          isGroup: true,
          title,
          description,
          participants: unique,
          admins: [userId],
          lastMessage: "Group created",
          lastAt: new Date(),
        });

        socket.emit("group:created", { chatId: chat._id });
        if (callback) callback({ success: true });
      } catch (err) {
        console.error("Group create error:", err);
        if (callback) callback({ success: false, error: err.message });
      }
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

    // Block/Unblock
    socket.on("user:block", async ({ targetUserId }, callback) => {
      try {
        await User.findByIdAndUpdate(userId, { $addToSet: { blockedUsers: targetUserId } });
        socket.emit("user:blocked", { targetUserId });
        io.emit("user:blockedBy", { blockedBy: userId, targetUserId });
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on("user:unblock", async ({ targetUserId }, callback) => {
      try {
        await User.findByIdAndUpdate(userId, { $pull: { blockedUsers: targetUserId } });
        socket.emit("user:unblocked", { targetUserId });
        io.emit("user:unblockedBy", { unblockedBy: userId, targetUserId });
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // Message Pinning
    socket.on("message:pin", async ({ messageId, chatId }, callback) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return callback?.({ success: false, error: "Chat not found" });

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
        callback?.({ success: false, error: err.message });
      }
    });

    socket.on("message:unpin", async ({ messageId, chatId }, callback) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return callback?.({ success: false, error: "Chat not found" });

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
        callback?.({ success: false, error: err.message });
      }
    });

    // Call signaling
    socket.on("call:initiate", async ({ targetUserId, callType }, callback) => {
      try {
        const call = await Call.create({
          caller: userId,
          receiver: targetUserId,
          type: callType,
          status: "initiated"
        });

        let targetSocketId = null;
        for (const [socketId, userData] of onlineUsers.entries()) {
          if (userData.userId === targetUserId) {
            targetSocketId = socketId;
            break;
          }
        }

        if (!targetSocketId) {
          call.status = "missed";
          await call.save();
          // Still send push if offline
        }

        const caller = await User.findById(userId).select("full_name phone avatar");

        if (targetSocketId) {
          io.to(targetSocketId).emit("call:incoming", {
            callId: call._id,
            callerId: userId,
            callerName: caller?.full_name || caller?.phone || "Unknown",
            callerAvatar: caller?.avatar,
            callType
          });
        }

        // ✅ Push for calls
        sendPush(targetUserId, {
          title: `Incoming ${callType} call`,
          body: `${caller?.full_name || caller?.phone} is calling you...`,
          icon: caller?.avatar || "/logo192.png",
          data: { callId: call._id, callerId: userId, notificationType: "call" }
        });

        callback?.({ success: true, callId: call._id });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    socket.on("call:accept", async ({ callId, callerId }) => {
      try {
        if (callId) await Call.findByIdAndUpdate(callId, { status: "completed", startedAt: new Date() });
        for (const [socketId, userData] of onlineUsers.entries()) {
          if (userData.userId === callerId) {
            io.to(socketId).emit("call:accepted", { recipientId: userId });
            break;
          }
        }
      } catch (err) { }
    });

    socket.on("call:reject", async ({ callId, callerId }) => {
      try {
        if (callId) await Call.findByIdAndUpdate(callId, { status: "declined" });
        for (const [socketId, userData] of onlineUsers.entries()) {
          if (userData.userId === callerId) {
            io.to(socketId).emit("call:rejected", { recipientId: userId });
            break;
          }
        }
      } catch (err) { }
    });

    socket.on("call:offer", ({ targetUserId, offer }) => {
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === targetUserId) {
          io.to(socketId).emit("call:offer", { callerId: userId, offer });
          break;
        }
      }
    });

    socket.on("call:answer", ({ targetUserId, answer }) => {
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === targetUserId) {
          io.to(socketId).emit("call:answer", { recipientId: userId, answer });
          break;
        }
      }
    });

    socket.on("call:ice-candidate", ({ targetUserId, candidate }) => {
      for (const [socketId, userData] of onlineUsers.entries()) {
        if (userData.userId === targetUserId) {
          io.to(socketId).emit("call:ice-candidate", { senderId: userId, candidate });
          break;
        }
      }
    });

    socket.on("call:end", async ({ callId, targetUserId, duration }) => {
      try {
        if (callId && duration !== undefined) await Call.findByIdAndUpdate(callId, { duration, endedAt: new Date() });
        for (const [socketId, userData] of onlineUsers.entries()) {
          if (userData.userId === targetUserId) {
            io.to(socketId).emit("call:ended", { endedBy: userId });
            break;
          }
        }
      } catch (err) { }
    });

  });

  return io;
};

module.exports = { mountIO };
