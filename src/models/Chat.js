// import mongoose from "mongoose";
const mongoose = require("mongoose")

const chatSchema = new mongoose.Schema({
  isGroup: { type: Boolean, default: false },     // 👈 groups
  title: String,                                  // 👈 group name
  description: String,                            // 👈 group description
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // 👈 admin-only
  lastMessage: String,
  lastAt: Date,
  lastEncryptedBody: String, // ✅ For sidebar E2EE decryption
  lastEncryptedKeys: [{       // ✅ For sidebar E2EE decryption
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    key: String
  }],
  pinnedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],        // 👈 pinned
  archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],      // 👈 archived
  hiddenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],        // 👈 hidden/deleted
  unread: { type: Map, of: Number, default: {} },                             // 👈 unread per userId
  clearedAt: { type: Map, of: Date, default: {} },                         // ✅ last clear time per userId
}, { timestamps: true });


chatSchema.index({ participants: 1 }, { unique: false });

// mongoose.model("Chat", chatSchema);

module.exports = mongoose.model("Chat", chatSchema)
