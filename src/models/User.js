// import mongoose from "mongoose";
const mongoose = require("mongoose")

const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true, required: true, index: true },
  full_name: String,
  email: { type: String, default: "" }, // ✅ New email field
  password_hash: { type: String, required: true },
  avatar: String,
  about: { type: String, default: "Hey there! I am using BTC Chat." },
  lastSeen: { type: Date, default: null },        // 👈 presence
  isOnline: { type: Boolean, default: false },    // 👈 presence
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // 👈 blocked users
  publicKey: String, // 👈 RSA public key for E2EE
}, { timestamps: true });


// export default mongoose.model("User", userSchema);

module.exports = mongoose.model("User", userSchema)
