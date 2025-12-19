const express = require("express");
const Status = require("../models/Status");
const { auth } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// ✅ Create status
router.post("/", auth, async (req, res) => {
    try {
        const { content, type, backgroundColor } = req.body;
        const status = await Status.create({
            user: req.user.id,
            content,
            type: type || "image",
            backgroundColor: backgroundColor || "#000000"
        });

        const populated = await Status.findById(status._id).populate("user", "full_name phone avatar");
        res.status(201).json(populated);
    } catch (err) {
        console.error("Failed to create status:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ✅ Get all statuses for user and contacts
router.get("/", auth, async (req, res) => {
    try {
        // In a real app, we'd filter by contacts. 
        // For now, let's get all statuses from the last 24 hours (MongoDB TTL handles deletion, but we fetch all active)
        const statuses = await Status.find()
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
