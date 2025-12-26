const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth").auth;
const Call = require("../models/Call");

// ✅ Fetch call history for authenticated user
router.get("/get-calls", auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const calls = await Call.find({
            $or: [{ caller: userId }, { receiver: userId }]
        })
            .populate("caller", "full_name phone avatar")
            .populate("receiver", "full_name phone avatar")
            .sort({ startedAt: -1 })
            .limit(50); // Get last 50 calls

        res.json(calls);
    } catch (err) {
        console.error("Fetch call history error:", err);
        res.status(500).json({ message: "Failed to fetch call history" });
    }
});

// ✅ Clear all call history for authenticated user
router.delete("/clear", auth, async (req, res) => {
    try {
        const userId = req.user.id;
        await Call.deleteMany({
            $or: [{ caller: userId }, { receiver: userId }]
        });
        res.json({ success: true, message: "Call history cleared" });
    } catch (err) {
        console.error("Clear call history error:", err);
        res.status(500).json({ message: "Failed to clear call history" });
    }
});

module.exports = router;
