const jwt = require("jsonwebtoken");
const User = require("../models/User");

const auth = async (req, res, next) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ Check if account is disabled
    const user = await User.findById(payload.id).select("isDisabled");
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.isDisabled) {
      return res.status(403).json({ message: "Account disabled. Contact admin." });
    }

    req.user = payload; // { id, phone }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = { auth };
