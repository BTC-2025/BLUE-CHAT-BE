// import { Router } from "express";
// import bcrypt from "bcryptjs";
// import jwt from "jsonwebtoken";
// import User from "../models/User.js";

const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const User = require('../models/User')

const router = express.Router();

const ConnectedApp = mongoose.models.ConnectedApp || mongoose.model('ConnectedApp', new mongoose.Schema({
  chatOriginId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  icon: { type: String },
  registeredAt: { type: Date, default: Date.now }
}));

router.post("/register", async (req, res) => {
  const { phone, full_name, password, avatar, publicKey, appName, appOrigin, appIcon } = req.body;
  if (!phone || !password) return res.status(400).json({ message: "Phone & password required" });

  // ✅ Register connected app if provided
  if (appOrigin && appName) {
    await ConnectedApp.findOneAndUpdate(
      { chatOriginId: appOrigin },
      { name: appName, icon: appIcon, registeredAt: new Date() },
      { upsert: true, new: true }
    );
  }

  const exists = await User.findOne({ phone });
  if (exists) return res.status(409).json({ message: "Phone already registered" });

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    phone,
    full_name: full_name || "",
    password_hash: hash,
    avatar: avatar || "", // ✅ Support avatar on signup
    publicKey: publicKey || "", // ✅ Support E2EE public key
    connectedOrigins: appOrigin ? [appOrigin] : [] // ✅ Init with origin
  });

  const token = jwt.sign({ id: user._id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.status(201).json({
    token,
    id: user._id,
    phone: user.phone,
    full_name: user.full_name,
    avatar: user.avatar,
    publicKey: user.publicKey,
    isDisabled: user.isDisabled,
    isBusiness: user.isBusiness || false,
    businessId: user.businessId || null
  });
});

router.post("/login", async (req, res) => {
  const { phone, password, appName, appOrigin, appIcon } = req.body;

  // ✅ Register connected app if provided
  if (appOrigin && appName) {
    await ConnectedApp.findOneAndUpdate(
      { chatOriginId: appOrigin },
      { name: appName, icon: appIcon, registeredAt: new Date() },
      { upsert: true, new: true }
    );
  }

  const user = await User.findOne({ phone });
  if (!user) return res.status(404).json({ message: "User not found" });

  if (user.isDisabled) {
    return res.status(403).json({ message: "Account disabled. Contact admin." });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(400).json({ message: "Wrong password" });

  // ✅ Add origin to user if new
  if (appOrigin) {
    if (!user.connectedOrigins?.includes(appOrigin)) {
      await User.findByIdAndUpdate(user._id, {
        $addToSet: { connectedOrigins: appOrigin }
      });
    }
  }

  const token = jwt.sign({ id: user._id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({
    token,
    id: user._id,
    phone: user.phone,
    full_name: user.full_name,
    avatar: user.avatar,
    publicKey: user.publicKey,
    isDisabled: user.isDisabled,
    isBusiness: user.isBusiness || false,
    businessId: user.businessId || null
  });
});

// Get current user info (for refreshing)
router.get("/me", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password_hash");

    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isDisabled) return res.status(403).json({ message: "Account disabled" });

    res.json({
      id: user._id,
      phone: user.phone,
      full_name: user.full_name,
      avatar: user.avatar,
      publicKey: user.publicKey,
      isDisabled: user.isDisabled,
      isBusiness: user.isBusiness || false,
      businessId: user.businessId || null
    });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(401).json({ message: "Invalid token" });
  }
});

// export default router;

module.exports = router
