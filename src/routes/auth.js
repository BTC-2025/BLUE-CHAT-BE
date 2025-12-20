// import { Router } from "express";
// import bcrypt from "bcryptjs";
// import jwt from "jsonwebtoken";
// import User from "../models/User.js";

const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/User')

const Otp = require('../models/Otp')
const { sendOtpEmail } = require('../utils/mail')

const router = express.Router();

// ✅ NEW: Send OTP to Email
router.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // Save to DB (expires in 5 mins)
    await Otp.create({ email, otp });

    // Send Email
    const success = await sendOtpEmail(email, otp);
    if (!success) throw new Error("Email delivery failed");

    res.json({ message: "Verification code sent to your email" });
  } catch (err) {
    console.error("OTP Error:", err);
    res.status(500).json({ message: "Failed to send verification code. Try again later." });
  }
});

router.post("/register", async (req, res) => {
  const { phone, full_name, password, avatar, publicKey, email, otp } = req.body;

  if (!phone || !password || !email || !otp) {
    return res.status(400).json({ message: "All fields and OTP are required" });
  }

  // 1. Verify OTP
  const validOtp = await Otp.findOne({ email, otp }).sort({ createdAt: -1 });
  if (!validOtp) {
    return res.status(400).json({ message: "Invalid or expired verification code" });
  }

  // OTP is valid, proceed with registration
  const exists = await User.findOne({ phone });
  if (exists) return res.status(409).json({ message: "Phone already registered" });

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    phone,
    full_name: full_name || "",
    email: email, // ✅ Store verified email
    password_hash: hash,
    avatar: avatar || "",
    publicKey: publicKey || ""
  });

  // Cleanup used OTP
  await Otp.deleteMany({ email });

  const token = jwt.sign({ id: user._id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.status(201).json({ token, id: user._id, phone: user.phone, full_name: user.full_name, avatar: user.avatar, publicKey: user.publicKey, email: user.email });
});

router.post("/login", async (req, res) => {
  const { phone, password } = req.body;
  const user = await User.findOne({ phone });
  if (!user) return res.status(404).json({ message: "User not found" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(400).json({ message: "Wrong password" });

  const token = jwt.sign({ id: user._id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, id: user._id, phone: user.phone, full_name: user.full_name, avatar: user.avatar, publicKey: user.publicKey });
});

// export default router;

module.exports = router
