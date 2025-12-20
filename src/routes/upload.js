const express = require("express");
const router = express.Router();
const multer = require("multer");
const jwt = require("jsonwebtoken");
const FileModel = require("../models/File");

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const mime = file.mimetype.toLowerCase();
        const isAllowed = mime.startsWith("image/") ||
            mime.startsWith("video/") ||
            mime.startsWith("audio/") ||
            [
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "text/plain",
                "application/octet-stream",
            ].includes(mime);

        if (isAllowed) {
            cb(null, true);
        } else {
            cb(new Error(`File type not allowed: ${mime}`), false);
        }
    },
});

// Auth middleware
const auth = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch {
        return res.status(401).json({ message: "Invalid token" });
    }
};

/**
 * @route   GET /api/upload/:id
 * @desc    Serve a file from the database
 * @access  Public (for chat media)
 */
router.get("/:id", async (req, res) => {
    try {
        const file = await FileModel.findById(req.params.id);
        if (!file) return res.status(404).json({ message: "File not found" });

        res.set("Content-Type", file.contentType);
        res.set("Cache-Control", "public, max-age=31536000"); // Cache for 1 year
        res.send(file.data);
    } catch (error) {
        res.status(500).json({ message: "Error retrieving file", error: error.message });
    }
});

/**
 * @route   POST /api/upload
 * @desc    Upload a file to the database
 * @access  Private
 */
router.post("/", auth, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file provided" });
        }

        // Save to Database
        const newFile = new FileModel({
            name: req.file.originalname,
            data: req.file.buffer,
            contentType: req.file.mimetype,
            size: req.file.size,
            userId: req.userId
        });

        await newFile.save();

        // Determine file type category for frontend logic
        let type = "file";
        if (req.file.mimetype.startsWith("image/")) type = "image";
        else if (req.file.mimetype.startsWith("video/")) type = "video";
        else if (req.file.mimetype.startsWith("audio/")) type = "audio";

        // Construct URL
        const protocol = req.protocol;
        const host = req.get("host");
        const fileUrl = `${protocol}://${host}/api/upload/${newFile._id}`;

        res.json({
            url: fileUrl,
            type,
            name: req.file.originalname,
            size: req.file.size,
            id: newFile._id
        });
    } catch (error) {
        console.error("Database Upload Error:", error);
        res.status(500).json({
            message: "Upload failed",
            error: error.message
        });
    }
});

module.exports = router;
