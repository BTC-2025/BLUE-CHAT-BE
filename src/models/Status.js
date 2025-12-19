const mongoose = require("mongoose");

const statusSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    content: { type: String, required: true }, // URL for image or text content
    type: { type: String, enum: ["image", "text"], default: "image" },
    backgroundColor: { type: String, default: "#000000" }, // For text statuses
    viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // TTL Index: Automatically delete document after 24 hours (86400 seconds)
    createdAt: { type: Date, default: Date.now, expires: 86400 }
}, { timestamps: true });

// Ensure the index is created
statusSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("Status", statusSchema);
