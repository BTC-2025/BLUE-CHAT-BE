// import { Router } from "express";
// import bcrypt from "bcryptjs";
// import jwt from "jsonwebtoken";
// import User from "../models/User.js";

const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/User')

const router = express.Router();

router.post("/register", async (req, res) => {
  const { phone, full_name, password, avatar } = req.body;
  if (!phone || !password) return res.status(400).json({ message: "Phone & password required" });

  const exists = await User.findOne({ phone });
  if (exists) return res.status(409).json({ message: "Phone already registered" });

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    phone,
    full_name: full_name || "",
    password_hash: hash,
    avatar: avatar || "" // ✅ Support avatar on signup
  });

  const token = jwt.sign({ id: user._id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.status(201).json({ token, id: user._id, phone: user.phone, full_name: user.full_name, avatar: user.avatar });
});

router.post("/login", async (req, res) => {
  const { phone, password } = req.body;
  const user = await User.findOne({ phone });
  if (!user) return res.status(404).json({ message: "User not found" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(400).json({ message: "Wrong password" });

  const token = jwt.sign({ id: user._id, phone: user.phone }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, id: user._id, phone: user.phone, full_name: user.full_name });
});

// export default router;

module.exports = router
