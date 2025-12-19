const Status = require("../models/Status");
const { auth } = require("../middleware/auth");
const User = require("../models/User");
const Chat = require("../models/Chat"); // ✅ Added Chat model

const router = express.Router();

// ✅ Create status
// ... (POST logic remains the same)

// ✅ Get statuses for user and their messaged contacts only
router.get("/", auth, async (req, res) => {
    try {
        // 1. Find all 1:1 chats where the user is a participant
        const chats = await Chat.find({
            isGroup: false,
            participants: req.user.id
        });

        // 2. Map to get the "other" person's ID from each chat
        const contactIds = chats.map(chat =>
            chat.participants.find(p => p.toString() !== req.user.id)
        ).filter(id => id); // Remove any nulls

        // 3. Fetch statuses where the user is either the current user or one of their contacts
        const allowedUserIds = [req.user.id, ...contactIds];

        const statuses = await Status.find({ user: { $in: allowedUserIds } })
            .populate("user", "full_name phone avatar")
            .sort({ createdAt: -1 });

        // Group by user
        const grouped = statuses.reduce((acc, status) => {
            const userId = status.user._id.toString();
            if (!acc[userId]) {
                acc[userId] = {
                    user: status.user,
                    statuses: []
                };
            }
            acc[userId].statuses.push(status);
            return acc;
        }, {});

        res.json(Object.values(grouped));
    } catch (err) {
        console.error("Failed to fetch statuses:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ✅ Delete status
router.delete("/:id", auth, async (req, res) => {
    try {
        const status = await Status.findById(req.params.id);
        if (!status) return res.status(404).json({ message: "Status not found" });

        if (status.user.toString() !== req.user.id) {
            return res.status(403).json({ message: "Unauthorized" });
        }

        await status.deleteOne();
        res.json({ message: "Status deleted" });
    } catch (err) {
        console.error("Failed to delete status:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ✅ Mark status as viewed
router.post("/view/:id", auth, async (req, res) => {
    try {
        const status = await Status.findById(req.params.id);
        if (!status) return res.status(404).json({ message: "Status not found" });

        if (!status.viewedBy.includes(req.user.id)) {
            status.viewedBy.push(req.user.id);
            await status.save();
        }
        res.json({ message: "Status marked as viewed" });
    } catch (err) {
        console.error("Failed to view status:", err);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;
