// import mongoose from "mongoose";
const mongoose = require("mongoose")

const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true, required: true, index: true },
  full_name: String,
  email: { type: String, default: "" }, // ✅ New email field
  password_hash: { type: String, required: true },
  avatar: String,
  about: { type: String, default: "Hey there! I am using BlueChat." },
  lastSeen: { type: Date, default: null },        // 👈 presence
  isOnline: { type: Boolean, default: false },    // 👈 presence
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // 👈 blocked users
  publicKey: String, // 👈 RSA public key for E2EE
  reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // ✅ users who reported this account
  isDisabled: { type: Boolean, default: false }, // ✅ account suspension flag
  pushSubscriptions: { type: Array, default: [] }, // ✅ push notification tokens
  messageRetentionDays: { type: Number, default: 0 }, // ✅ 0 = Disabled, 1 = 24h, 7 = 7d, 30 = 30d
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // ✅ starred contacts
  isBusiness: { type: Boolean, default: false }, // ✅ business account flag
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business" }, // ✅ reference to business profile
}, { timestamps: true });


// export default mongoose.model("User", userSchema);

module.exports = mongoose.model("User", userSchema)
