const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Business = require('../models/Business');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

// ✅ Define ConnectedApp Schema Inline
const connectedAppSchema = new mongoose.Schema({
    chatOriginId: { type: String, required: true, unique: true }, // e.g. 'ecommerce'
    name: { type: String, required: true }, // e.g. 'E-commerce Store'
    icon: { type: String },
    registeredAt: { type: Date, default: Date.now }
});
// Check if model exists to avoid overwrite error in hot reload
const ConnectedApp = mongoose.models.ConnectedApp || mongoose.model('ConnectedApp', connectedAppSchema);

const router = express.Router();

/**
 * @route GET /api/integration/apps
 * @desc Get all registered connected apps
 * @access Public
 */
router.get('/apps', async (req, res) => {
    try {
        // ✅ 1. Check for Authorization header
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return res.json({ success: true, apps: [] }); // No token -> No visible apps
        }

        // ✅ 2. Verify User
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user || !user.connectedOrigins || user.connectedOrigins.length === 0) {
            return res.json({ success: true, apps: [] });
        }

        // ✅ 3. Return only apps matches user's connected origins
        const apps = await ConnectedApp.find({
            chatOriginId: { $in: user.connectedOrigins }
        }).sort({ name: 1 });

        res.json({ success: true, apps });
    } catch (err) {
        console.error("Fetch Apps Error:", err);
        res.status(500).json({ message: "Server error fetching apps" });
    }
});

/**
 * @route POST /api/integration/auth
 * @desc Get or Create a User for External App Integration (E-commerce/Organic Store)
 * @access Public
 */
router.post('/auth', async (req, res) => {
    try {
        const { phone, full_name, store_name, avatar, isBusiness, password, appName, appOrigin, appIcon } = req.body;

        // ✅ 0. Register/Update Connected App if origin is provided
        if (appOrigin && appName) {
            await ConnectedApp.findOneAndUpdate(
                { chatOriginId: appOrigin },
                { name: appName, icon: appIcon, registeredAt: new Date() },
                { upsert: true, new: true }
            );
        }

        if (!phone) {
            return res.status(400).json({ message: "Phone number is required" });
        }

        // 1. Check if user exists
        let user = await User.findOne({ phone });
        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            // Create a password
            let hash;
            if (password) {
                hash = await bcrypt.hash(password, 10);
            } else {
                const randomPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
                hash = await bcrypt.hash(randomPassword, 10);
            }

            user = await User.create({
                phone,
                full_name: full_name || (isBusiness ? store_name : `Guest`),
                password_hash: hash,
                avatar: avatar || "",
                about: `Joined via ${store_name || 'E-commerce Demo'}`,
                isOnline: true,
                isBusiness: !!isBusiness,
                connectedOrigins: appOrigin ? [appOrigin] : [] // ✅ Init with origin
            });
        } else {
            // ✅ Existing user: Add origin if not present
            if (appOrigin) {
                await User.findByIdAndUpdate(user._id, {
                    $addToSet: { connectedOrigins: appOrigin }
                });
                // Update local user object to reflect change immediately if needed (optional)
                user.connectedOrigins = user.connectedOrigins || [];
                if (!user.connectedOrigins.includes(appOrigin)) {
                    user.connectedOrigins.push(appOrigin);
                }
            }
        }

        // 2. Handle Business Role Updates
        if (isBusiness) {
            // Ensure isBusiness is true if it wasn't
            if (!user.isBusiness) {
                user.isBusiness = true;
                await user.save();
            }

            // Check if Business profile exists
            let business = await Business.findOne({ userId: user._id });
            if (!business) {
                business = await Business.create({
                    userId: user._id,
                    businessName: store_name || `${full_name || 'Seller'}'s Store`,
                    category: 'Retail',
                    status: 'approved', // Auto-approve for demo
                    approvedAt: new Date()
                });

                user.businessId = business._id;
                await user.save();
            }
        }

        const token = jwt.sign({ id: user._id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "30d" });

        res.status(isNewUser ? 201 : 200).json({
            success: true,
            isNewUser,
            token,
            user: {
                id: user._id,
                phone: user.phone,
                full_name: user.full_name,
                avatar: user.avatar,
                isBusiness: user.isBusiness,
                businessId: user.businessId
            }
        });

    } catch (err) {
        console.error("Integration Auth Error:", err);
        res.status(500).json({ message: "Server error during integration auth" });
    }
});

/**
 * @route POST /api/integration/chat
 * @desc Create or Get a Chat between current user and another user (Seller/Buyer)
 * @access Protected (via Token)
 */
router.post('/chat', async (req, res) => {
    try {
        // manual token verification since we didn't add auth middleware to this specific router file yet
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ message: "No token" });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const myId = decoded.id;

        const { participantId, initialMessage } = req.body;

        if (!participantId) return res.status(400).json({ message: "Participant ID required" });

        // Check if chat exists
        let chat = await Chat.findOne({
            isGroup: false,
            origin: 'ecommerce',
            participants: { $all: [myId, participantId] }
        });

        if (!chat) {
            chat = await Chat.create({
                isGroup: false,
                participants: [myId, participantId],
                origin: 'ecommerce',
                lastAt: new Date(),
                unread: { [participantId]: 1, [myId]: 0 } // Mark unread for recipient
            });
        }

        // Send initial message if provided
        if (initialMessage) {
            const msg = await Message.create({
                chat: chat._id,
                sender: myId,
                body: initialMessage,
                type: 'text'
            });

            chat.lastMessage = initialMessage;
            chat.lastAt = new Date();
            await chat.save();

            // Emit socket event if IO is available
            const io = req.app.get("io");
            if (io) {
                io.to(participantId).emit("new_message", msg);
                io.to(myId).emit("new_message", msg);
            }
        }

        res.json({ success: true, chat });
    } catch (err) {
        console.error("Integration Chat Error:", err);
        res.status(500).json({ message: "Server error creating chat" });
    }
});

/**
 * @route GET /api/integration/products
 * @desc Get all products for the feed (Demo purpose)
 * @access Public
 */
router.get('/products', async (req, res) => {
    try {
        // Find all businesses that are approved? Or just all products since it's a demo
        // For better demo, fetch all products
        const products = await require('../models/Product').find({ inStock: true })
            .populate({
                path: 'businessId',
                select: 'businessName category userId' // include userId to start chat
            })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        res.json({ success: true, products });
    } catch (err) {
        console.error("Integration Products Error:", err);
        res.status(500).json({ message: "Server error fetching products" });
    }
});

module.exports = router;
