const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth").auth;
const User = require("../models/User");

// ✅ Subscribe to push notifications
router.post("/subscribe", auth, async (req, res) => {
    try {
        const subscription = req.body;
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ message: "Invalid subscription" });
        }

        await User.findByIdAndUpdate(req.user.id, {
            $addToSet: { pushSubscriptions: subscription }
        });

        res.status(201).json({ success: true });
    } catch (err) {
        console.error("Scale subscription error:", err);
        res.status(500).json({ message: "Failed to subscribe" });
    }
});

// ✅ Unsubscribe from push notifications
router.post("/unsubscribe", auth, async (req, res) => {
    try {
        const subscription = req.body;
        await User.findByIdAndUpdate(req.user.id, {
            $pull: { pushSubscriptions: subscription }
        });
        res.json({ success: true });
    } catch (err) {
        console.error("Unsubscribe error:", err);
        res.status(500).json({ message: "Failed to unsubscribe" });
    }
});

module.exports = router;
