// import { Router } from "express";
// import User from "../models/User.js";
// import { auth } from "../middleware/auth.js";


const express = require('express')
const User = require('../models/User')
const { auth } = require('../middleware/auth')

const router = express.Router();

// search by phone to start chat
router.get("/search/:phone", auth, async (req, res) => {
  const u = await User.findOne({ phone: req.params.phone });
  if (!u) return res.status(404).json({ message: "User not found" });
  res.json({ id: u._id, phone: u.phone, full_name: u.full_name, avatar: u.avatar, publicKey: u.publicKey });
});

router.get("/me", auth, async (req, res) => {
  const me = await User.findById(req.user.id).select("-password_hash").lean();
  res.json(me);
});

router.patch("/me", auth, async (req, res) => {
  const { full_name, about, avatar } = req.body;
  const me = await User.findByIdAndUpdate(req.user.id, { full_name, about, avatar }, { new: true }).select("-password_hash");
  res.json(me);
});

// ✅ Profile update endpoint (for ProfileModal)
router.put("/profile", auth, async (req, res) => {
  const { full_name, avatar } = req.body;
  const me = await User.findByIdAndUpdate(
    req.user.id,
    { full_name, avatar },
    { new: true }
  ).select("-password_hash");
  res.json(me);
});

router.patch("/update-public-key", auth, async (req, res) => {
  const { publicKey } = req.body;
  const user = await User.findByIdAndUpdate(req.user.id, { publicKey }, { new: true }).select("-password_hash");
  res.json(user);
});


// export default router;

module.exports = router

