const mongoose = require("mongoose");

const callSchema = new mongoose.Schema({
    caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["audio", "video"], default: "audio" },
    status: { type: String, enum: ["initiated", "missed", "completed", "declined", "busy"], default: "initiated" },
    duration: { type: Number, default: 0 }, // In seconds
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model("Call", callSchema);
