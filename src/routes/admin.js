const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Business = require('../models/Business');
const { adminAuth } = require('../middleware/adminAuth');

// Admin Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password required' });
        }

        const admin = await Admin.findOne({ username });

        if (!admin) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isValid = await bcrypt.compare(password, admin.password_hash);

        if (!isValid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Update last login
        admin.lastLogin = new Date();
        await admin.save();

        // Create admin JWT token
        const token = jwt.sign(
            { adminId: admin._id, username: admin.username },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.json({
            token,
            admin: {
                id: admin._id,
                username: admin.username,
                email: admin.email
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Verify Admin Session
router.get('/verify', adminAuth, (req, res) => {
    res.json({ valid: true, admin: req.admin });
});

// Logout (client-side token removal, but good to track)
router.post('/logout', adminAuth, (req, res) => {
    res.json({ message: 'Logged out successfully' });
});

// Get All Businesses (with filters)
router.get('/business/all', adminAuth, async (req, res) => {
    try {
        const { status } = req.query;
        const filter = status ? { status } : {};

        const businesses = await Business.find(filter)
            .populate('userId', 'full_name phone email')
            .populate('approvedBy', 'username')
            .sort({ createdAt: -1 })
            .lean();

        res.json(businesses);
    } catch (error) {
        console.error('Get businesses error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get Pending Business Registrations
router.get('/business/pending', adminAuth, async (req, res) => {
    try {
        const businesses = await Business.find({ status: 'pending' })
            .populate('userId', 'full_name phone email avatar')
            .sort({ createdAt: -1 })
            .lean();

        res.json(businesses);
    } catch (error) {
        console.error('Get pending businesses error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve Business
router.post('/business/:id/approve', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { verified } = req.body; // Optional: mark as verified

        const business = await Business.findById(id);

        if (!business) {
            return res.status(404).json({ message: 'Business not found' });
        }

        if (business.status === 'approved') {
            return res.status(400).json({ message: 'Business already approved' });
        }

        business.status = 'approved';
        business.approvedAt = new Date();
        business.approvedBy = req.admin.id;
        if (verified !== undefined) {
            business.verified = verified;
        }

        await business.save();

        // Update user's isBusiness flag
        const User = require('../models/User');
        await User.findByIdAndUpdate(business.userId, {
            isBusiness: true,
            businessId: business._id
        });

        res.json({ message: 'Business approved successfully', business });
    } catch (error) {
        console.error('Approve business error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reject Business
router.post('/business/:id/reject', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ message: 'Rejection reason required' });
        }

        const business = await Business.findById(id);

        if (!business) {
            return res.status(404).json({ message: 'Business not found' });
        }

        business.status = 'rejected';
        business.rejectionReason = reason;

        await business.save();

        res.json({ message: 'Business rejected', business });
    } catch (error) {
        console.error('Reject business error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
