const Message = require("./models/Message");
const User = require("./models/User");

/**
 * Retention Worker
 * 
 * Periodically scans for users with a message retention policy
 * and marks older messages as 'deletedFor' that user.
 */
const runRetentionCleanup = async () => {
    console.log("🧹 Running Message Retention Cleanup...");
    try {
        // 1. Find all users who have a retention policy
        const users = await User.find({ messageRetentionDays: { $gt: 0 } }).select("_id messageRetentionDays");

        if (users.length === 0) {
            console.log("✨ No retention policies active.");
            return;
        }

        let totalMessagesUpdated = 0;

        for (const user of users) {
            const userId = user._id;
            const days = user.messageRetentionDays;

            // Calculate threshold date (e.g., 24h, 7d, 30d ago)
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);

            // Find messages for this user that:
            // - Are older than cutoffDate
            // - Are NOT already marked as deletedFor this user
            // - ARE related to this user (sender OR part of a chat involving this user)
            // Note: Since 'deletedFor' hides it from the UI, we just need to target all messages
            // where this user is a participant. To keep it simple and efficient, we update messages
            // that this user HASN'T deleted yet.

            const result = await Message.updateMany(
                {
                    createdAt: { $lt: cutoffDate },
                    deletedFor: { $ne: userId },
                    // We only want to target chats where this user is a participant.
                    // However, we don't store participant list in the Message model directly.
                    // Instead, we can join with Chat, but updateMany doesn't support joins well.
                    // Simpler approach: update ALL messages older than X where user isn't in deletedFor.
                    // This is safe because if the user isn't in the chat, they wouldn't see it anyway.
                },
                {
                    $addToSet: { deletedFor: userId }
                }
            );

            totalMessagesUpdated += result.modifiedCount;
            // console.log(`   ✅ User ${userId}: Processed ${result.modifiedCount} expired messages.`);
        }

        console.log(`🎊 Cleanup complete. Total messages processed: ${totalMessagesUpdated}`);
    } catch (err) {
        console.error("❌ Retention Cleanup Error:", err);
    }
};

const startRetentionWorker = () => {
    // Run immediately on start
    runRetentionCleanup();

    // Then run every hour
    setInterval(runRetentionCleanup, 60 * 60 * 1000);
};

module.exports = { startRetentionWorker };
