// import mongoose from "mongoose";
const { mongoose } = require('mongoose')

const messageSchema = new mongoose.Schema({
  chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  body: String,
  attachments: [{
    url: String, type: { type: String } // image|file|audio, etc.
  }],
  // Reply to another message
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  // Forward info
  forwardedFrom: {
    originalSender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    originalChat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" }
  },
  // ✅ Encryption fields
  encryptedBody: String,
  encryptedKeys: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    key: String // AES key encrypted with this user's RSA public key
  }],
  // ✅ Emoji reactions
  reactions: [{
    emoji: String,
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  }],
  status: { type: String, enum: ["sent", "delivered", "seen"], default: "sent" },
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  deletedForEveryone: { type: Boolean, default: false },
  // Pin message fields
  isPinned: { type: Boolean, default: false },
  pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  pinnedAt: Date
}, { timestamps: true });


messageSchema.index({ chat: 1, createdAt: 1 });

// export default mongoose.model("Message", messageSchema);

module.exports = mongoose.model("Message", messageSchema)



