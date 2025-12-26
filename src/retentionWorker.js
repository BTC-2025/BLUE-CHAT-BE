const Message = require("./models/Message");
const User = require("./models/User");
const Chat = require("./models/Chat");
const mongoose = require("mongoose");

const runRetentionCleanup = async () => {
    console.log("🧹 [RetentionWorker] Starting cleanup cycle...");
    try {
        const users = await User.find({ messageRetentionDays: { $gt: 0 } }).select("_id messageRetentionDays full_name");

        if (users.length === 0) {
            console.log("✨ [RetentionWorker] No active retention policies found.");
            return;
        }

        console.log(`🔍 [RetentionWorker] Found ${users.length} users with active policies.`);

        let totalMessagesUpdated = 0;

        for (const user of users) {
            const userId = user._id;
            const days = user.messageRetentionDays;
            const userObjectId = new mongoose.Types.ObjectId(userId);

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);

            console.log(`   👉 Processing "${user.full_name}" (Policy=${days}d, Cutoff=${cutoffDate.toISOString()})`);

            // 1. Find all chats this user is in
            const userChats = await Chat.find({ participants: userId }).select("_id");
            const chatIds = userChats.map(c => c._id);

            if (chatIds.length === 0) continue;

            // 2. Mark old messages in THESE chats as deleted for THIS user
            const result = await Message.updateMany(
                {
                    chat: { $in: chatIds },
                    createdAt: { $lt: cutoffDate },
                    deletedFor: { $ne: userObjectId },
                },
                {
                    $addToSet: { deletedFor: userObjectId }
                }
            );

            if (result.modifiedCount > 0) {
                console.log(`   ✅ [RetentionWorker] Resolved ${result.modifiedCount} expired messages for ${user.full_name}.`);
                totalMessagesUpdated += result.modifiedCount;
            }
        }

        console.log(`🎊 [RetentionWorker] Cycle complete. Total messages processed: ${totalMessagesUpdated}`);
    } catch (err) {
        console.error("❌ [RetentionWorker] ERROR:", err);
    }
};

const startRetentionWorker = () => {
    // Run immediately on start
    runRetentionCleanup();

    // Then run every 5 minutes while we verify the feature
    setInterval(runRetentionCleanup, 5 * 60 * 1000);
};

module.exports = { startRetentionWorker };
