const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    username: {
        type: String,
        unique: true,
        required: true,
        index: true
    },
    password_hash: {
        type: String,
        required: true
    },
    email: {
        type: String,
        default: ''
    },
    lastLogin: {
        type: Date,
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('Admin', adminSchema);
