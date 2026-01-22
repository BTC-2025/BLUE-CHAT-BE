const jwt = require('jsonwebtoken');

const adminAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ message: 'Admin authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

        // Check if it's an admin token
        if (!decoded.adminId) {
            return res.status(401).json({ message: 'Invalid admin token' });
        }

        req.admin = {
            id: decoded.adminId,
            username: decoded.username
        };

        next();
    } catch (error) {
        console.error('Admin auth error:', error);
        return res.status(401).json({ message: 'Invalid or expired admin token' });
    }
};

module.exports = { adminAuth };
