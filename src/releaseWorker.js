const Message = require("./models/Message");
const Chat = require("./models/Chat");
const User = require("./models/User");
const PendingDelivery = require("./models/PendingDelivery");

/**
 * Periodically checks for scheduled messages that are due and "releases" them.
 * @param {object} io - The Socket.IO server instance for broadcasting.
 */
const startReleaseWorker = (io) => {
    // Check every 30 seconds
    setInterval(async () => {
        try {
            const now = new Date();
            // Find all unreleased messages that are past their scheduled time
            const dueMessages = await Message.find({
                isReleased: false,
                scheduledAt: { $lte: now }
            }).populate("sender", "full_name phone avatar");

            if (dueMessages.length === 0) return;

            console.log(`[Worker] Releasing ${dueMessages.length} scheduled messages...`);

            for (const msg of dueMessages) {
                // 1. Mark as released
                msg.isReleased = true;
                await msg.save();

                const chatId = String(msg.chat);
                const chat = await Chat.findById(chatId);
                if (!chat) continue;

                // 2. Update Chat metadata
                chat.lastMessage = msg.body || (msg.attachments?.length ? "[attachment]" : "[message]");
                chat.lastAt = msg.createdAt;
                chat.lastEncryptedBody = msg.encryptedBody || null;
                chat.lastEncryptedKeys = msg.encryptedKeys || [];

                // 3. Handle Delivery & Unread Logic
                const socketIdSet = io.sockets.adapter.rooms.get(chatId) || new Set();
                const userIdsInRoom = new Set();
                for (const sid of socketIdSet) {
                    const s = io.sockets.sockets.get(sid);
                    if (s?.data?.userId) userIdsInRoom.add(String(s.data.userId));
                }

                const deliveredTo = [];
                for (const p of chat.participants) {
                    const pid = String(p);
                    if (pid === String(msg.sender)) continue;

                    if (userIdsInRoom.has(pid)) {
                        deliveredTo.push(pid);
                    } else {
                        // Recipient offline or not in room -> bump unread & create pending
                        const current = Number(chat.unread.get(pid) || 0);
                        chat.unread.set(pid, current + 1);
                        await PendingDelivery.create({ user: pid, message: msg._id });
                    }
                }
                await chat.save();

                if (deliveredTo.length) {
                    await Message.findByIdAndUpdate(msg._id, {
                        status: "delivered",
                        deliveredTo: deliveredTo,
                    });
                }

                // 4. Broadcast to the room
                const msgPayload = await Message.findById(msg._id)
                    .populate("sender", "full_name phone avatar")
                    .populate({
                        path: "replyTo",
                        select: "body sender attachments",
                        populate: { path: "sender", select: "full_name phone" }
                    })
                    .lean();

                io.to(chatId).emit("message:new", msgPayload);
                io.to(chatId).emit("chats:update", {
                    chatId,
                    lastMessage: chat.lastMessage,
                    lastAt: chat.lastAt,
                });
            }
        } catch (error) {
            console.error("[Worker] Error in release worker:", error);
        }
    }, 30000); // 30 seconds
};

module.exports = { startReleaseWorker };
