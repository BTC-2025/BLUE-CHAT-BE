const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const { auth } = require('../middleware/auth'); // ✅ Import Auth Middleware

// ✅ Apply Auth Middleware to all routes
router.use(auth);

// ✅ Create a new Task
router.post('/create', async (req, res) => {
    try {
        const { title, description, chatId, assigneeIds } = req.body;
        const senderId = req.user.id; // ✅ Use req.user.id

        // Validate Chat
        const chat = await Chat.findById(chatId);
        if (!chat) return res.status(404).json({ message: "Chat not found" });

        // Verify User is in Chat (optional security check)
        // ...

        // Create Task
        const task = new Task({
            title,
            description,
            chat: chatId,
            assignedBy: senderId,
            assignees: assigneeIds.map(uid => ({ user: uid, status: 'pending' }))
        });
        await task.save();

        // Create System Message for the Task
        const message = new Message({
            chat: chatId,
            sender: senderId,
            body: `Assigned a task: ${title}`,
            task: task._id,
            status: 'sent'
        });
        await message.save();

        // Populate task details for response
        await task.populate('assignees.user', 'full_name phone avatar');
        await task.populate('assignedBy', 'full_name phone');

        // Emit Socket Event (handled by caller or separate utility)
        // We'll rely on the frontend to emit or a global emitter here if available
        const io = req.app.get('io');
        if (io) {
            // ✅ Mongoose document.populate() returns a Promise, so passing an array is safer/cleaner
            await message.populate([
                { path: 'sender' },
                {
                    path: 'task',
                    populate: [
                        { path: 'assignees.user', select: 'full_name phone avatar' },
                        { path: 'assignedBy', select: 'full_name phone' }
                    ]
                }
            ]);
            io.to(chatId).emit('message:new', message);
        }

        res.status(201).json({ task, message });
    } catch (err) {
        console.error("Create Task Error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ✅ Update Task Status (for an assignee)
router.put('/:taskId/status', async (req, res) => {
    try {
        const { taskId } = req.params;
        const { status, reason } = req.body;
        const userId = req.user.id; // ✅ Use req.user.id

        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: "Task not found" });

        // Log logic: find the assignee entry for this user
        const assignee = task.assignees.find(a => a.user.toString() === userId);
        if (!assignee) return res.status(403).json({ message: "You are not assigned to this task" });

        assignee.status = status;
        assignee.reason = reason || assignee.reason;
        assignee.updatedAt = new Date();

        await task.save();

        // Emit update
        const io = req.app.get('io');
        if (io) {
            io.to(task.chat.toString()).emit('task:update', { taskId, userId, status, reason });
        }

        res.json(task);
    } catch (err) {
        console.error("Update Task Error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ✅ Get Tasks for a Chat
router.get('/chat/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        const tasks = await Task.find({ chat: chatId })
            .populate('assignees.user', 'full_name phone avatar')
            .populate('assignedBy', 'full_name phone')
            .sort({ createdAt: -1 });

        res.json(tasks);
    } catch (err) {
        console.error("Get Tasks Error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;
