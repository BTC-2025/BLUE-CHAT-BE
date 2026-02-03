const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const ConnectedApp = require('../models/ConnectedApp');

const router = express.Router();

// Middleware to validate Origin Header exists
const requireOrigin = async (req, res, next) => {
    const origin = req.headers['x-chat-origin'];
    if (!origin) {
        return res.status(400).json({ error: 'Missing x-chat-origin header' });
    }

    // Optional: Validate if origin is registered
    // const app = await ConnectedApp.findOne({ chatOriginId: origin });
    // if (!app) return res.status(403).json({ error: 'Invalid origin' });

    req.chatOrigin = origin;
    next();
};

/**
 * @route POST /api/v1/register
 * @desc Register or Get User for a specific Origin
 */
router.post('/register', requireOrigin, async (req, res) => {
    try {
        const { userId, name, avatar, email } = req.body; // userId from external system
        const origin = req.chatOrigin;

        if (!userId || !name) {
            return res.status(400).json({ error: 'userId and name are required' });
        }

        // Construct a unique phone/id for this internal user to avoid conflicts
        // Strategy: prefix external ID with origin
        const pseudoPhone = `${origin}:${userId}`;

        let user = await User.findOne({ phone: pseudoPhone });

        if (!user) {
            // New User
            const password = Math.random().toString(36).slice(-10);
            const hash = await bcrypt.hash(password, 10);

            user = await User.create({
                phone: pseudoPhone,
                full_name: name,
                avatar: avatar || "",
                email: email || "",
                password_hash: hash,
                about: `User from ${origin}`,
                connectedOrigins: [origin],
                isOnline: true
            });
        } else {
            // Update existing if needed
            if (!user.connectedOrigins.includes(origin)) {
                user.connectedOrigins.push(origin);
                await user.save();
            }
            if (avatar && user.avatar !== avatar) {
                user.avatar = avatar;
                await user.save();
            }
        }

        const token = jwt.sign({ id: user._id, origin }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                externalId: userId,
                name: user.full_name,
                avatar: user.avatar
            }
        });

    } catch (err) {
        console.error('API Register Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * @route POST /api/v1/login
 * @desc Login (Simulated exchange of external token for chat token)
 * @note In a real scenario, we might verify a signature or API Key here.
 */
router.post('/login', requireOrigin, async (req, res) => {
    // For now, /register acts as login/register upsert. 
    // This route can be explicit login if password is used, 
    // but for "Headless" mode, we usually trust the server-to-server call or the upsert.
    // We will redirect to /register logic for simplicity in this demo,
    // or implement password auth if the user wants standard login.

    // For this implementation, we assume the client uses /register to authenticate/ensure user exists.
    res.status(400).json({ message: "Use POST /register to authenticate external users." });
});

/**
 * @route GET /api/v1/chats
 * @desc Get all chats for the user (Filtered by Origin)
 */
router.get('/chats', requireOrigin, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Unauthorized" });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const myId = decoded.id;

        // Find chats where this user is a participant AND chat origin matches
        const chats = await Chat.find({
            participants: myId,
            origin: req.chatOrigin
        })
            .populate('participants', 'full_name avatar phone isOnline lastSeen')
            .sort({ lastAt: -1 });

        // Transform for API
        const formattedChats = chats.map(chat => {
            const otherUser = chat.participants.find(p => p._id.toString() !== myId);
            return {
                id: chat._id,
                name: otherUser ? otherUser.full_name : "Unknown",
                avatar: otherUser ? otherUser.avatar : "",
                lastMessage: chat.lastMessage,
                lastAt: chat.lastAt,
                unreadCount: chat.unread ? chat.unread[myId] || 0 : 0
            };
        });

        res.json({ success: true, chats: formattedChats });

    } catch (err) {
        console.error('API Get Chats Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * @route POST /api/v1/chats
 * @desc Start a chat with another user (by their external ID provided in 'register')
 */
router.post('/chats', requireOrigin, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Unauthorized" });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const myId = decoded.id;
        const origin = req.chatOrigin;

        const { targetUserId } = req.body;
        if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });

        // Resolve target user internal ID
        const targetPseudoPhone = `${origin}:${targetUserId}`;
        const targetUser = await User.findOne({ phone: targetPseudoPhone });

        if (!targetUser) {
            return res.status(404).json({ error: 'Target user not found. They must be registered first.' });
        }

        // Find or Create Chat
        let chat = await Chat.findOne({
            isGroup: false,
            origin: origin,
            participants: { $all: [myId, targetUser._id] }
        });

        if (!chat) {
            chat = await Chat.create({
                isGroup: false,
                participants: [myId, targetUser._id],
                origin: origin,
                lastAt: new Date(),
                unread: { [targetUser._id]: 0, [myId]: 0 }
            });
        }

        res.json({ success: true, chatId: chat._id });

    } catch (err) {
        console.error('API Start Chat Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * @route GET /api/v1/messages/:chatId
 * @desc Get messages for a chat
 */
router.get('/messages/:chatId', requireOrigin, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Unauthorized" });

        // Improve: Check if user is participant of chat
        const messages = await Message.find({ chat: req.params.chatId })
            .sort({ createdAt: 1 })
            .lean();

        res.json({ success: true, messages });
    } catch (err) {
        console.error('API Get Messages Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * @route POST /api/v1/messages
 * @desc Send a message
 */
router.post('/messages', requireOrigin, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Unauthorized" });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const myId = decoded.id;

        const { chatId, text } = req.body;
        if (!chatId || !text) return res.status(400).json({ error: 'chatId and text required' });

        const msg = await Message.create({
            chat: chatId,
            sender: myId,
            body: text,
            type: 'text'
        });

        // Update Chat
        await Chat.findByIdAndUpdate(chatId, {
            lastMessage: text,
            lastAt: new Date(),
            $inc: { [`unread.${myId}`]: 0 } // Reset my unread (optional logic)
            // Ideally should increment others, but complex without 'participants' in this scope easily
        });

        // Simple increment unread for others logic
        const chat = await Chat.findById(chatId);
        chat.participants.forEach(pId => {
            if (pId.toString() !== myId) {
                // Initialize if undefined
                if (!chat.unread) chat.unread = {};
                const current = chat.unread.get(pId.toString()) || 0;
                chat.unread.set(pId.toString(), current + 1);
            }
        });
        await chat.save();


        // Emit Socket if available
        const io = req.app.get("io");
        if (io) {
            io.to(chatId).emit("message:new", msg);
        }

        res.json({ success: true, message: msg });

    } catch (err) {
        console.error('API Send Message Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
